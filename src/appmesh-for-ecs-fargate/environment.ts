import * as appmesh from '@aws-cdk/aws-appmesh';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as logs from '@aws-cdk/aws-logs';
import * as servicediscovery from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';

export interface EnvironmentProps {
  readonly namespaceName?: string;
  readonly vpc?: ec2.IVpc;
  readonly cluster?: ecs.Cluster;
  readonly logGroup?: logs.ILogGroup;
  readonly mesh?: appmesh.Mesh;
};

export class Environment extends cdk.Construct {
  vpc: ec2.IVpc
  cluster: ecs.Cluster
  logGroup: logs.ILogGroup
  namespace: servicediscovery.INamespace
  mesh: appmesh.Mesh;

  constructor(scope: cdk.Construct, id: string, props: EnvironmentProps) {
    super(scope, id);

    const namespaceName = props.namespaceName || 'local';

    this.vpc = props.vpc || new ec2.Vpc(this, 'VPC');

    this.cluster = props.cluster || new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: true,
      vpc: this.vpc,
    });

    this.namespace = this.cluster.addDefaultCloudMapNamespace({ name: namespaceName });

    this.logGroup = props.logGroup || new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.mesh = props.mesh || new appmesh.Mesh(this, 'Mesh', { egressFilter: appmesh.MeshFilterType.ALLOW_ALL });
  };
};