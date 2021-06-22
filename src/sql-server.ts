import * as path from 'path';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import * as rds from '@aws-cdk/aws-rds';
import * as cdk from '@aws-cdk/core';

interface DatabaseProps {
  readonly db: rds.DatabaseInstance;
  readonly databaseName: string;
};

export class Database extends cdk.Construct {

  constructor(scope: cdk.Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const databaseName = props.databaseName;
    const db = props.db;
    const dbSecretArn: string = db.secret?.secretFullArn || '';

    const createDatabaseFunction = new NodejsFunction(this, 'CreateDatabaseFunction', {
      entry: path.resolve(__dirname, '..', 'lambda-packages', 'create_database_handler', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      environment: {
        DB_SECRET_ARN: dbSecretArn,
      },
      vpc: db.vpc,
    });
    createDatabaseFunction.connections.allowTo(db, ec2.Port.tcp(1433));
    createDatabaseFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecretArn],
    }));

    new cdk.CustomResource(this, databaseName, {
      serviceToken: createDatabaseFunction.functionArn,
      properties: {
        DatabaseName: databaseName,
      },
    });
  };
}