import { CustomResource } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface ManagedPrefixListProps {
  managedPrefixListName: string;
};

export class ManagedPrefixList extends Construct {
  managedPrefixListId: string;
  managedPrefixListName: string;

  constructor(scope: Construct, id: string, props: ManagedPrefixListProps) {
    super(scope, id);

    const { managedPrefixListName } = props;

    const onEventHandler = new NodejsFunction(this, 'LookupManagedPrefixListFunction', {
      description: 'hoge',
      entry: './src/functions/lookup-managed-prefix-list/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      architecture: lambda.Architecture.ARM_64,
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['ec2:DescribeManagedPrefixLists'],
          resources: ['*'],
        }),
      ],
    });
    const provider = new cr.Provider(this, 'Provider', { onEventHandler });

    const managedPrefixList = new CustomResource(this, 'ManagedPrefixList', {
      serviceToken: provider.serviceToken,
      properties: {
        managedPrefixListName,
      },
    });

    this.managedPrefixListName = managedPrefixListName;
    this.managedPrefixListId = managedPrefixList.ref;

  }
};