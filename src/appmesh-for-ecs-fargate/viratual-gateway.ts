
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as elb from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as servicediscovery from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';
import { Environment, VirtualService, envoyImage, xrayImage, cloudwatchImage } from './';

interface NetworkLoadBalancedVirtualGatewayProps {
  readonly environment: Environment;
  readonly desiredCount?: number;
  readonly internetFacing?: boolean;
  readonly certificate?: acm.ICertificate;
}

export class NetworkLoadBalancedVirtualGateway extends cdk.Construct {
  virtualGateway: appmesh.VirtualGateway;
  connectable?: ec2.IConnectable;
  loadBalancer: elb.INetworkLoadBalancer;

  constructor(scope: cdk.Construct, id: string, props: NetworkLoadBalancedVirtualGatewayProps) {
    super(scope, id);

    const serviceName = id;
    const desiredCount = props.desiredCount || 2;
    const internetFacing = props.internetFacing || false;
    const certificate = props.certificate;

    const logGroup = props.environment.logGroup;
    const awsLogDriver = new ecs.AwsLogDriver({ logGroup: logGroup, streamPrefix: serviceName });

    const mesh = props.environment.mesh;
    const cluster = props.environment.cluster;
    const vpc = cluster.vpc;

    this.virtualGateway = new appmesh.VirtualGateway(this, 'VirtualGateway', {
      listeners: [appmesh.VirtualNodeListener.http({ port: 8080 })],
      mesh,
    });

    const ecsTaskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
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

    ecsTaskDefinition.addContainer('envoy', {
      image: envoyImage,
      user: '1337',
      memoryLimitMiB: 500,
      portMappings: [
        { containerPort: 8080 },
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

    ecsTaskDefinition.addContainer('xray-daemon', {
      image: xrayImage,
      cpu: 32,
      memoryReservationMiB: 256,
      essential: true,
      portMappings: [{
        containerPort: 2000,
        protocol: ecs.Protocol.UDP,
      }],
      logging: awsLogDriver,
    });

    ecsTaskDefinition.addContainer('cw-agent', {
      image: cloudwatchImage,
      //cpu: 32,
      //memoryReservationMiB: 256,
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

    const ecsService = new ecs.FargateService(this, 'Service', {
      cluster: cluster,
      taskDefinition: ecsTaskDefinition,
      desiredCount: desiredCount,
      enableECSManagedTags: true,
      cloudMapOptions: {
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
        failureThreshold: 2,
        name: `${serviceName.toLowerCase()}.gw`,
      },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE', base: 1, weight: 0 },
        { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 1 },
      ],
    });
    this.connectable = ecsService;

    const targetGroup = new elb.NetworkTargetGroup(this, 'TargetGroup', { port: 8080, targets: [ecsService], vpc });
    this.loadBalancer = new elb.NetworkLoadBalancer(this, 'LoadBalancer', { internetFacing, vpc });
    if (certificate) {
      this.loadBalancer.addListener('Listener', {
        port: 443,
        certificates: [elb.ListenerCertificate.fromCertificateManager(certificate)],
        defaultTargetGroups: [targetGroup],
      });
    } else {
      this.loadBalancer.addListener('Listener', {
        port: 80,
        defaultTargetGroups: [targetGroup],
      });
    }
    // for HealthCheck
    ecsService.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(8080), 'Accept inbound traffic from NLB.');
  };

  addGatewayRoute(prefixPath: string, otherService: VirtualService) {
    this.virtualGateway.addGatewayRoute(prefixPath, {
      routeSpec: appmesh.GatewayRouteSpec.http({
        match: { prefixPath },
        routeTarget: otherService.virtualService,
      }),
    });
    if (this.connectable && otherService.connectable) {
      this.connectable.connections.allowTo( otherService.connectable, ec2.Port.tcp(otherService.trafficPort) );
    };
  };
};
