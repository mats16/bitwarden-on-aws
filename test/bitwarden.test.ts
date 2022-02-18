import * as cdk from 'aws-cdk-lib';
import { Capture, Match, Template } from 'aws-cdk-lib/assertions';
import { BitwardenStack } from '../src/bitwarden-stack';

const testEnv: cdk.Environment = {
  account: '123456789012',
  region: 'us-west-2',
};

test('Snapshot', () => {
  const app = new cdk.App();
  const stack = new BitwardenStack(app, 'test', { env: testEnv });

  //expect(stack).not.toHaveResource('AWS::EC2::VPC');
  //expect(stack).toHaveResource('AWS::EC2::VPC');
  expect(app.synth().getStackArtifact(stack.artifactId).template).toMatchSnapshot();
});