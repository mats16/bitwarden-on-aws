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
  readonly virtualServiceName: string;
  readonly listenerPort?: number;
};

export interface FargateVirtualServiceProps extends VirtualServiceProps {
  readonly applicationContainer: ecs.ContainerDefinitionOptions;
  readonly desiredCount?: number;
  readonly healthCheckPath?: string;
};

export class VirtualService extends cdk.Construct {
  listenerPort: number;
  virtualService: appmesh.VirtualService;
  virtualRouter: appmesh.VirtualRouter;
  virtualNodes: appmesh.VirtualNode[];

  constructor(scope: cdk.Construct, id: string, props: VirtualServiceProps) {
    super(scope, id);

    const virtualServiceName = props.virtualServiceName;  // FQDN
    const mesh = props.environment.mesh;
    const namespace = props.environment.namespace;
    const namespaceName = namespace.namespaceName

    this.listenerPort = props.listenerPort || 5000;

    this.virtualNodes = [];

    this.virtualRouter = new appmesh.VirtualRouter(this, 'VirtualRouter', {
      listeners: [ appmesh.VirtualRouterListener.http(this.listenerPort) ],
      mesh
    });

    this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
      virtualServiceName,
      virtualServiceProvider: appmesh.VirtualServiceProvider.virtualRouter(this.virtualRouter)
    });

    if (virtualServiceName.endsWith(namespaceName)) {
      // https://docs.aws.amazon.com/app-mesh/latest/userguide/troubleshoot-connectivity.html#ts-connectivity-dns-resolution-virtual-service
      new servicediscovery.Service(this, 'DummyService', {
        namespace: namespace,
        name: virtualServiceName.replace(`.${namespaceName}`, ''),
        dnsRecordType: servicediscovery.DnsRecordType.A,
        description: 'The dummy for App Mesh',
      }).registerIpInstance('DummyInstance', { ipv4: '10.10.10.10' });
    };
  };

  addBackend(otherService: VirtualService) {
    this.virtualNodes.forEach((virtualNode) => {
      virtualNode.addBackend(appmesh.Backend.virtualService(otherService.virtualService));
    });
  };
};

export class FargateVirtualService extends VirtualService {
  ecsTaskDefinition: ecs.FargateTaskDefinition;
  applicationContainer: ecs.ContainerDefinition;

  constructor(scope: cdk.Construct, id: string, props: FargateVirtualServiceProps) {
    super(scope, id, props);

    const serviceName = id.toLowerCase();
    const desiredCount = props.desiredCount ?? 2;
    const mesh = props.environment.mesh;
    const namespace = props.environment.namespace;
    const cluster = props.environment.cluster;
    const securityGroup = props.environment.securityGroup;
    const logGroup = props.environment.logGroup;
    const awsLogDriver = new ecs.AwsLogDriver({ logGroup: logGroup, streamPrefix: serviceName });

    const healthCheckPath = props.healthCheckPath || '/';

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
          appPorts: [this.listenerPort],
          proxyIngressPort: 15000,
          proxyEgressPort: 15001,
          egressIgnoredPorts: [2049], // EFS
          egressIgnoredIPs: ['169.254.170.2', '169.254.169.254'],
        },
      }),
      volumes: [{ name: 'LogVolume' }],
    });

    const applicationContainerOptions = {
      ...props.applicationContainer,
      portMappings: [{ containerPort: this.listenerPort }],
      logging: awsLogDriver,
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${this.listenerPort}${healthCheckPath} || exit 1`],
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
                  log_stream_name: `etc/bitwarden/logs/${serviceName}`,
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

    const ecsService = new ecs.FargateService(this, `${imageTag}-Service`, {
      cluster,
      taskDefinition: this.ecsTaskDefinition,
      securityGroups: [securityGroup],
      desiredCount: desiredCount,
      enableECSManagedTags: true,
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
        failureThreshold: 2,
        name: [imageTag, serviceName, 'node'].join('.'),
      },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE', base: 1, weight: 0 },
        { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 1 },
      ],
    });

    // Create a virtual node for the name service
    const virtualNode = new appmesh.VirtualNode(this, 'DefaultVirtualNode', {
      serviceDiscovery: appmesh.ServiceDiscovery.cloudMap({
        service: ecsService.cloudMapService!,
      }),
      accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
      listeners: [
        appmesh.VirtualNodeListener.http({
          port: this.listenerPort,
          connectionPool: {
            maxConnections: 1024,
            maxPendingRequests: 1024,
          },
        }),
      ],
      mesh,
    });
    this.virtualNodes.push(virtualNode);

    this.virtualRouter.addRoute('DefaultRoute', {
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
  };
};

export interface ExternalVirtualServiceProps extends VirtualServiceProps {
  readonly protocol?: 'http' | 'http2' | 'tcp' | 'grpc';
};

export class ExternalVirtualService extends VirtualService {

  constructor(scope: cdk.Construct, id: string, props: ExternalVirtualServiceProps) {
    super(scope, id, props);

    const mesh = props.environment.mesh;
    const protocol = props.protocol || 'tcp';

    const virtualNodeListener = (() => {
      switch (protocol) {
          case 'http': return appmesh.VirtualNodeListener.http({ port: this.listenerPort })
          case 'http2': return appmesh.VirtualNodeListener.http2({ port: this.listenerPort })
          //case 'grpc': return appmesh.RouteSpec.grpc({ weightedTargets: [{ virtualNode: virtualNode }] });
          default : return appmesh.VirtualNodeListener.tcp({ port: this.listenerPort })
      }
    })();

    const virtualNode = new appmesh.VirtualNode(this, 'DefaultVirtualNode', {
      serviceDiscovery: appmesh.ServiceDiscovery.dns(this.virtualService.virtualServiceName),
      accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
      listeners: [virtualNodeListener],
      //listeners: [
      //  appmesh.VirtualNodeListener.http({
      //    port: this.listenerPort,
      //    //connectionPool: {
      //    //  maxConnections: 1024,
      //    //  maxPendingRequests: 1024,
      //    //},
      //  }),
      //],
      mesh,
    });
    this.virtualNodes.push(virtualNode);

    const routeSpec = (() => {
      switch (protocol) {
          case 'http': return appmesh.RouteSpec.http({ weightedTargets: [{ virtualNode: virtualNode }] });
          case 'http2': return appmesh.RouteSpec.http2({ weightedTargets: [{ virtualNode: virtualNode }] });
          //case 'grpc': return appmesh.RouteSpec.grpc({ weightedTargets: [{ virtualNode: virtualNode }] });
          default : return appmesh.RouteSpec.tcp({ weightedTargets: [{ virtualNode: virtualNode }] });
      }
    })();

    this.virtualRouter.addRoute('DefaultRoute', {
      routeSpec: routeSpec,
    });
  };
};
