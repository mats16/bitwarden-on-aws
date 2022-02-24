const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.12.0',
  defaultReleaseBranch: 'main',
  name: 'bitwarden-on-aws',
  deps: [
    '@aws-sdk/client-ec2',
    '@aws-sdk/client-secrets-manager',
    '@types/aws-lambda',
    'axios',
    'tedious',
  ],
  devDeps: [
    'esbuild@0',
    '@types/tedious',
    '@types/jest',
    'jest',
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