
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as efs from '@aws-cdk/aws-efs';
import * as iam from '@aws-cdk/aws-iam';
import * as servicediscovery from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';
import { Environment, envoyImage, xrayImage, cloudwatchImage } from './';

export interface VirtualServiceProps {
  readonly environment: Environment;
  readonly trafficPort?: number;
  readonly endpoint?: string;
  readonly connectable?: ec2.IConnectable;
};

export interface FargateVirtualServiceProps extends VirtualServiceProps {
  readonly applicationContainer: ecs.ContainerDefinitionOptions;
  readonly desiredCount?: number;
  readonly healthCheckPath?: string;
};

export class VirtualService extends cdk.Construct {
  serviceName: string;
  trafficPort: number;
  virtualService: appmesh.VirtualService;
  virtualRouter?: appmesh.VirtualRouter;
  virtualNodes: appmesh.VirtualNode[];
  connectable?: ec2.IConnectable;

  constructor(scope: cdk.Construct, id: string, props: VirtualServiceProps) {
    super(scope, id);

    this.serviceName = id.toLowerCase();
    this.trafficPort = props.trafficPort || 5000;
    this.connectable = props.connectable;

    const namespace = props.environment.namespace;
    const mesh = props.environment.mesh;
    const endpoint = props.endpoint;

    if (endpoint) {
      const virtualServiceName = endpoint;
      const virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        mesh,
        serviceDiscovery: appmesh.ServiceDiscovery.dns(endpoint),
        listeners: [
          appmesh.VirtualNodeListener.tcp({
            port: this.trafficPort,
            connectionPool: { maxConnections: 1024 }
          }),
        ],
        accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
      });
      this.virtualNodes = [virtualNode];
      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(virtualNode),
      });
    } else {
      // https://docs.aws.amazon.com/app-mesh/latest/userguide/troubleshoot-connectivity.html#ts-connectivity-dns-resolution-virtual-service
      const service = new servicediscovery.Service(this, 'DummyService', {
        namespace: namespace,
        name: [this.serviceName, 'svc'].join('.'),
        dnsRecordType: servicediscovery.DnsRecordType.A,
        description: 'The dummy for App Mesh',
      });
      service.registerIpInstance('DummyInstance', { ipv4: '10.10.10.10' });

      this.virtualNodes = [];
      this.virtualRouter = new appmesh.VirtualRouter(this, 'VirtualRouter', {
        listeners: [
          appmesh.VirtualRouterListener.http(this.trafficPort)
        ],
        mesh,
      });
      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: [service.serviceName, namespace.namespaceName].join('.'),
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualRouter(this.virtualRouter),
      });
    };
  };

  addBackend(otherService: VirtualService) {
    this.virtualNodes.forEach((virtualNode) => {
      virtualNode.addBackend(appmesh.Backend.virtualService(otherService.virtualService));
    });
    if (this.connectable && otherService.connectable) {
      this.connectable.connections.allowTo( otherService.connectable, ec2.Port.tcp(otherService.trafficPort) );
    };
  };
};

export class FargateVirtualService extends VirtualService {
  //virtualRouter: appmesh.VirtualRouter;
  ecsTaskDefinition: ecs.FargateTaskDefinition;
  applicationContainer: ecs.ContainerDefinition;

  constructor(scope: cdk.Construct, id: string, props: FargateVirtualServiceProps) {
    super(scope, id, props);

    const cluster = props.environment.cluster;
    const vpc = cluster.vpc;
    //const namespace = props.environment.namespace;
    const mesh = props.environment.mesh;

    const logGroup = props.environment.logGroup;
    const awsLogDriver = new ecs.AwsLogDriver({ logGroup: logGroup, streamPrefix: this.serviceName });

    const healthCheckPath = props.healthCheckPath || '/';
    const desiredCount = props.desiredCount ?? 2;
    const imageName: string = JSON.parse(JSON.stringify(props.applicationContainer.image)).imageName;
    const imageTag: string = (imageName.split(':')[1] || 'latest').replace(/\./g, '-');

    this.ecsTaskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 512,
      memoryLimitMiB: 1024,
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
      proxyConfiguration: new ecs.AppMeshProxyConfiguration({
        containerName: 'envoy',
        properties: {
          ignoredUID: 1337,
          ignoredGID: 1338,
          appPorts: [this.trafficPort],
          proxyIngressPort: 15000,
          proxyEgressPort: 15001,
          egressIgnoredPorts: [
            //1433, // SQL Server - https://github.com/aws/aws-app-mesh-roadmap/issues/270
            2049, // EFS
          ],
          egressIgnoredIPs: ['169.254.170.2', '169.254.169.254'],
        },
      }),
      volumes: [{
        name: 'LogVolume',
      }],
    });

    const applicationContainerOptions = {
      ...props.applicationContainer,
      portMappings: [{ containerPort: this.trafficPort }],
      logging: awsLogDriver,
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${this.trafficPort}${healthCheckPath} || exit 1`],
        startPeriod: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2),
        retries: 3,
      },
    };

    this.applicationContainer = this.ecsTaskDefinition.addContainer('app', applicationContainerOptions);
    this.applicationContainer.addUlimits({
      name: ecs.UlimitName.NOFILE,
      hardLimit: 1024000,
      softLimit: 1024000,
    });
    this.applicationContainer.addMountPoints({
      sourceVolume: 'LogVolume',
      containerPath: '/etc/bitwarden/logs/',
      readOnly: false,
    });

    this.ecsTaskDefinition.addContainer('xray-daemon', {
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

    this.ecsTaskDefinition.addContainer('cw-agent', {
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
          logs: {
            logs_collected: {
              files: {
                collect_list: [{
                  file_path: '/etc/bitwarden/logs/**.txt',
                  auto_removal: true,
                  log_group_name: logGroup.logGroupName,
                  log_stream_name: `etc/bitwarden/logs/${this.serviceName}`,
                  timestamp_format: '%Y-%m-%d %H:%M:%S.',
                }],
              },
            },
          },
        }),
      },
      logging: awsLogDriver,
    }).addMountPoints({
      sourceVolume: 'LogVolume',
      containerPath: '/etc/bitwarden/logs/',
      readOnly: false,
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', { vpc });
    this.connectable = securityGroup;

    const ecsService = new ecs.FargateService(this, `${imageTag}-Service`, {
      cluster,
      taskDefinition: this.ecsTaskDefinition,
      securityGroups: [securityGroup],
      desiredCount: desiredCount,
      enableECSManagedTags: true,
      cloudMapOptions: {
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
        failureThreshold: 2,
        name: [imageTag, this.serviceName, 'node'].join('.'),
      },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE', base: 1, weight: 0 },
        { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 1 },
      ],
    });

    // Create a virtual node for the name service
    const virtualNode = new appmesh.VirtualNode(this, 'DefaultVirtualNode', {
      mesh: mesh,
      serviceDiscovery: appmesh.ServiceDiscovery.cloudMap({
        service: ecsService.cloudMapService!,
      }),
      listeners: [
        appmesh.VirtualNodeListener.http({
          port: this.trafficPort,
          connectionPool: {
            maxConnections: 1024,
            maxPendingRequests: 1024
          }
        }),
      ],
      accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
    });
    this.virtualNodes.push(virtualNode);

    this.virtualRouter?.addRoute(imageTag, {
      routeSpec: appmesh.RouteSpec.http({
        weightedTargets: [{ virtualNode: virtualNode }],
      }),
    });

    const proxyContainer = this.ecsTaskDefinition.addContainer('envoy', {
      image: envoyImage,
      user: '1337',
      cpu: 256,
      memoryReservationMiB: 64,
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'curl -s http://localhost:9901/server_info | grep state | grep -q LIVE'],
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2),
        retries: 3,
        startPeriod: cdk.Duration.seconds(10),
      },
      environment: {
        APPMESH_VIRTUAL_NODE_NAME: `mesh/${mesh.meshName}/virtualNode/${virtualNode.virtualNodeName}`,
        AWS_REGION: cdk.Aws.REGION,
        ENABLE_ENVOY_DOG_STATSD: '1',
        ENABLE_ENVOY_STATS_TAGS: '1',
        ENABLE_ENVOY_XRAY_TRACING: '1',
      },
      logging: awsLogDriver,
    });
    proxyContainer.addUlimits({
      name: ecs.UlimitName.NOFILE,
      hardLimit: 1024000,
      softLimit: 1024000,
    });

    this.applicationContainer.addContainerDependencies({
      container: proxyContainer,
      condition: ecs.ContainerDependencyCondition.HEALTHY,
    });
  };

  addVolume(accessPoint: efs.AccessPoint, containerPath: string) {
    const volumeName = accessPoint.accessPointId;
    this.ecsTaskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: accessPoint.fileSystem.fileSystemId,
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
        },
        transitEncryption: 'ENABLED',
      },
    });
    this.applicationContainer.addMountPoints({
      sourceVolume: volumeName,
      containerPath: containerPath,
      readOnly: false,
    });
    if (this.connectable) {
      this.connectable.connections.allowTo(accessPoint.fileSystem, ec2.Port.tcp(2049));
    }
  };
};
