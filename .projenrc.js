const { AwsCdkTypeScriptApp } = require('projen');
const project = new AwsCdkTypeScriptApp({
  cdkVersion: '1.109.0',
  defaultReleaseBranch: 'main',
  name: 'bitwarden-on-aws',
  cdkDependencies: [
    '@aws-cdk/aws-appmesh',
    '@aws-cdk/aws-certificatemanager',
    '@aws-cdk/aws-codebuild',
    '@aws-cdk/aws-ec2',
    '@aws-cdk/aws-ecr-assets',
    '@aws-cdk/aws-ecs',
    '@aws-cdk/aws-efs',
    '@aws-cdk/aws-elasticloadbalancingv2',
    '@aws-cdk/aws-iam',
    '@aws-cdk/aws-lambda',
    '@aws-cdk/aws-lambda-nodejs',
    '@aws-cdk/aws-logs',
    '@aws-cdk/aws-rds',
    '@aws-cdk/aws-route53',
    '@aws-cdk/aws-route53-targets',
    '@aws-cdk/aws-s3-assets',
    '@aws-cdk/aws-secretsmanager',
    '@aws-cdk/aws-servicediscovery',
    '@aws-cdk/aws-wafv2',
    '@aws-cdk/custom-resources',
  ],
  deps: [
    'cdk-ses-helpers@^0.0.2',
    '@aws-sdk/client-secrets-manager',
    'axios',
    'tedious',
  ],
  devDeps: [
    'esbuild@0',
    '@types/aws-lambda',
    '@types/tedious',
  ],
  tsconfig: {
    compilerOptions: {
      noUnusedLocals: false,
      strictPropertyInitialization: false,
    },
  },
  gitignore: [
    'cdk.context.json',
  ],
  // cdkDependencies: undefined,        /* Which AWS CDK modules (those that start with "@aws-cdk/") this app uses. */
  // deps: [],                          /* Runtime dependencies of this module. */
  // description: undefined,            /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],                       /* Build dependencies for this module. */
  // packageName: undefined,            /* The "name" in package.json. */
  // projectType: ProjectType.UNKNOWN,  /* Which type of project this is (library/app). */
  // release: undefined,                /* Add release management to this project. */
});
project.synth();