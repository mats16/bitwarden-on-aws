import { App, Environment } from 'aws-cdk-lib';
import { BitwardenStack } from './bitwarden-stack';
import { BitwardenWafStack } from './bitwarden-waf-stack';

// for development, use account/region from cdk cli
const defaultEnv: Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new BitwardenWafStack(app, 'BitwardenWafStack', { env: { account: defaultEnv.account, region: 'us-east-1' } });
new BitwardenStack(app, 'BitwardenStack', { env: defaultEnv });

app.synth();