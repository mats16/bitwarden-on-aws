import { App, Environment } from '@aws-cdk/core';
import { BitwardenStack } from './bitwarden-stack';

// for development, use account/region from cdk cli
const defaultEnv: Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new BitwardenStack(app, 'BitwardenStack', { env: defaultEnv });

app.synth();