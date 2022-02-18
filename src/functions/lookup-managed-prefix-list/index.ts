import { EC2Client, DescribeManagedPrefixListsCommand } from '@aws-sdk/client-ec2';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';

const region = process.env.AWS_REGION;

interface Props {
  managedPrefixListName: string;
  ServiceToken: string;
};

const lookupManagedPrefixList = async (prefixListName: string) => {
  const client = new EC2Client({ region });
  const cmd = new DescribeManagedPrefixListsCommand({});
  const { PrefixLists } = await client.send(cmd);
  const managedPrefixList = PrefixLists?.find(x => x.PrefixListName == prefixListName);
  if (typeof managedPrefixList == 'undefined') {
    throw Error('Not found managed prefix list');
  };
  const response: CdkCustomResourceResponse = {
    PhysicalResourceId: managedPrefixList?.PrefixListId,
    Data: {
      Name: managedPrefixList?.PrefixListName,
      Arn: managedPrefixList?.PrefixListArn,
    },
  };
  return response;
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const { managedPrefixListName } = event.ResourceProperties as Props;

  switch (event.RequestType) {
    case 'Create': {
      return lookupManagedPrefixList(managedPrefixListName);
    }
    case 'Update': {
      return lookupManagedPrefixList(managedPrefixListName);
    }
    case 'Delete': {
      return {};
    }
  };
};