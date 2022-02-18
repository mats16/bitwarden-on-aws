import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export interface EnvironmentProps {
  readonly namespaceName?: string;
  readonly vpc?: ec2.IVpc;
  readonly securityGroup?: ec2.SecurityGroup;
  readonly cluster?: ecs.Cluster;
  readonly logGroup?: logs.ILogGroup;
  readonly mesh?: appmesh.Mesh;
};

export class Environment extends Construct {
  vpc: ec2.IVpc
  securityGroup: ec2.SecurityGroup
  cluster: ecs.Cluster
  defaultCapacityProviderStrategies: ecs.CapacityProviderStrategy[];
  logGroup: logs.ILogGroup
  namespace: servicediscovery.INamespace
  mesh: appmesh.Mesh;

  constructor(scope: Construct, id: string, props?: EnvironmentProps) {
    super(scope, id);

    const namespaceName = props?.namespaceName || 'local';

    this.vpc = props?.vpc || new ec2.Vpc(this, 'VPC');

    this.securityGroup = props?.securityGroup || new ec2.SecurityGroup(this, 'SecurityGroup', { vpc: this.vpc });
    this.securityGroup.connections.allowInternally(ec2.Port.tcp(5000));

    this.cluster = props?.cluster || new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: true,
      vpc: this.vpc,
    });

    this.defaultCapacityProviderStrategies = [
      { capacityProvider: 'FARGATE', base: 0, weight: 0 },
      { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 1 },
    ],

    this.namespace = this.cluster.addDefaultCloudMapNamespace({ name: namespaceName });

    this.logGroup = props?.logGroup || new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.mesh = props?.mesh || new appmesh.Mesh(this, 'Mesh', {
      meshName: 'Bitwarden',
      egressFilter: appmesh.MeshFilterType.ALLOW_ALL,
    });
  };
};