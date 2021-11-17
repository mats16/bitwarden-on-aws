import * as appmesh from '@aws-cdk/aws-appmesh';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as servicediscovery from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';
import { Environment, VirtualService, envoyImage, xrayImage, cloudwatchImage } from './';

interface FargateVirtualGatewayProps {
  readonly environment: Environment;
  readonly listenerPort?: number;
  readonly desiredCount?: number;
  readonly minHealthyPercent?: number;
  readonly maxHealthyPercent?: number;
}

export class FargateVirtualGateway extends cdk.Construct {
  virtualGateway: appmesh.VirtualGateway;
  listenerPort: number;
  ecsService: ecs.FargateService;

  constructor(scope: cdk.Construct, id: string, props: FargateVirtualGatewayProps) {
    super(scope, id);

    this.listenerPort = props.listenerPort || 8080;

    const serviceName = id.toLowerCase();
    const desiredCount = props.desiredCount ?? 2;
    const minHealthyPercent = props.minHealthyPercent ?? 50;
    const maxHealthyPercent = props.maxHealthyPercent ?? 200;
    const mesh = props.environment.mesh;
    const cluster = props.environment.cluster;
    const capacityProviderStrategies = props.environment.defaultCapacityProviderStrategies;
    const appSecurityGroup = props.environment.securityGroup;
    const logGroup = props.environment.logGroup;
    const awsLogDriver = new ecs.AwsLogDriver({ logGroup: logGroup, streamPrefix: serviceName });

    this.virtualGateway = new appmesh.VirtualGateway(this, 'VirtualGateway', {
      accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
      listeners: [appmesh.VirtualNodeListener.http({
        port: this.listenerPort,
        connectionPool: {
          maxConnections: 1024,
          maxPendingRequests: 1024,
        },
      })],
      mesh,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      taskRole: new iam.Role(this, 'TaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          { managedPolicyArn: 'arn:aws:iam::aws:policy/AWSAppMeshEnvoyAccess' },
          { managedPolicyArn: 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess' },
          { managedPolicyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy' },
        ],
      }),
      executionRole: new iam.Role(this, 'TaskExecutionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [{ managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy' }],
      }),
    });

    taskDefinition.addContainer('envoy', {
      image: envoyImage,
      user: '1337',
      cpu: 208,
      memoryLimitMiB: 320,
      portMappings: [
        { containerPort: this.listenerPort },
        { containerPort: 9901 },
      ],
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'curl -s http://localhost:9901/server_info | grep state | grep -q LIVE'],
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2),
        startPeriod: cdk.Duration.seconds(60),
        retries: 3,
      },
      environment: {
        APPMESH_VIRTUAL_NODE_NAME: `mesh/${mesh.meshName}/virtualGateway/${this.virtualGateway.virtualGatewayName}`,
        AWS_REGION: cdk.Aws.REGION,
        ENABLE_ENVOY_DOG_STATSD: '1',
        ENABLE_ENVOY_STATS_TAGS: '1',
        ENABLE_ENVOY_XRAY_TRACING: '1',
      },
      logging: awsLogDriver,
    }).addUlimits({
      name: ecs.UlimitName.NOFILE,
      hardLimit: 1024000,
      softLimit: 1024000,
    });

    taskDefinition.addContainer('xray-daemon', {
      image: xrayImage,
      cpu: 16,
      memoryReservationMiB: 128,
      essential: true,
      portMappings: [{
        containerPort: 2000,
        protocol: ecs.Protocol.UDP,
      }],
      logging: awsLogDriver,
    });

    taskDefinition.addContainer('cw-agent', {
      image: cloudwatchImage,
      cpu: 32,
      memoryReservationMiB: 64,
      essential: true,
      portMappings: [{
        containerPort: 8125,
        protocol: ecs.Protocol.UDP,
      }],
      environment: {
        CW_CONFIG_CONTENT: JSON.stringify({
          metrics: {
            namespace: 'AppMesh/Envoy/StatsD',
            metrics_collected: {
              statsd: {
                metrics_aggregation_interval: 0,
              },
            },
          },
        }),
      },
      logging: awsLogDriver,
    });

    this.ecsService = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount,
      minHealthyPercent,
      maxHealthyPercent,
      enableECSManagedTags: true,
      cloudMapOptions: {
        dnsRecordType: servicediscovery.DnsRecordType.SRV,
        dnsTtl: cdk.Duration.seconds(10),
        failureThreshold: 2,
        name: serviceName,
        containerPort: this.listenerPort,
      },
      capacityProviderStrategies,
    });
    this.ecsService.connections.allowTo(appSecurityGroup, ec2.Port.tcp(5000));
  };

  addGatewayRoute(prefixPath: string, otherService: VirtualService) {
    this.virtualGateway.addGatewayRoute(prefixPath, {
      routeSpec: appmesh.GatewayRouteSpec.http({
        match: { path: appmesh.HttpGatewayRoutePathMatch.startsWith(prefixPath) },
        routeTarget: otherService.virtualService,
        // need to add rewrite options
      }),
    });
  };
};
