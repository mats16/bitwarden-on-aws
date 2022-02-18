import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

interface DatabaseProps {
  readonly databaseName: string;
  readonly db: rds.DatabaseInstance | rds.DatabaseCluster;
  readonly vpc: ec2.Vpc;
};

export class Database extends cdk.CustomResource {

  constructor(scope: Construct, id: string, props: DatabaseProps) {

    const databaseName = props.databaseName;
    const db = props.db;
    const vpc = props.vpc;
    const dbSecretArn: string = db.secret!.secretFullArn!;

    const createDatabaseFunction = new NodejsFunction(scope, `${id}-CreateDatabaseFunction`, {
      entry: path.resolve(__dirname, '..', 'lambda-packages', 'create_database_handler', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      environment: {
        DB_SECRET_ARN: dbSecretArn,
      },
      vpc,
    });
    createDatabaseFunction.connections.allowTo(db, ec2.Port.tcp(1433));
    createDatabaseFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecretArn],
    }));

    super(scope, id, {
      serviceToken: createDatabaseFunction.functionArn,
      properties: {
        DatabaseName: databaseName,
      },
    });
  };
}