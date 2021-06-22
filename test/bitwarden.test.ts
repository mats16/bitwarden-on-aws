import '@aws-cdk/assert/jest';
import { App, Environment } from '@aws-cdk/core';
import { BitwardenStack } from '../src/bitwarden-stack';

const testEnv: Environment = {
  account: '123456789012',
  region: 'us-west-2',
};

test('Snapshot', () => {
  const app = new App();
  const stack = new BitwardenStack(app, 'test', { env: testEnv });

  //expect(stack).not.toHaveResource('AWS::EC2::VPC');
  expect(stack).toHaveResource('AWS::EC2::VPC');
  expect(app.synth().getStackArtifact(stack.artifactId).template).toMatchSnapshot();
});