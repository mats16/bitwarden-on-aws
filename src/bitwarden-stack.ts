import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Asset as s3Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

import { Environment, FargateVirtualGateway, ExternalVirtualService, FargateVirtualService } from './appmesh-for-ecs-fargate';
import { ManagedPrefixList } from './resources/managed-prefix-list';
import { globalSettings, adminSettings, webAclArn } from './settings';
import { Database } from './sql-server';

const namespaceName = 'bitwarden.local';
const databaseName = 'vault';

const LOCAL_UID = '1000';
const LOCAL_GID = '1000';

const efsAcl: efs.Acl = {
  ownerGid: LOCAL_UID,
  ownerUid: LOCAL_GID,
  permissions: '0755',
};
const efsPosixUser: efs.PosixUser = {
  uid: LOCAL_UID,
  gid: LOCAL_GID,
};

export class BitwardenStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    const identityServerCertificatePasswordSecret = new secretsmanager.Secret(this, 'IdentityServerCertificatePassword', {
      description: '[Bitwarden] Identity Server Certificate Password',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });
    const oidcIdentityClientKeySecret = new secretsmanager.Secret(this, 'OidcIdentityClientKey', {
      description: '[Bitwarden] A randomly generated OpenID Connect client key.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });
    const duoAKeySecret = new secretsmanager.Secret(this, 'DuoAKey', {
      description: '[Bitwarden] A randomly generated Duo akey.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

//    const smtpSecret = new SmtpSecret(this, 'SmtpSecret', { sesRegion: this.region });
//    const sesIdentity = new ManagedIdentity(this, 'SesIdentity', { sesRegion: this.region, subDomainName: `bitwarden-${cdk.Aws.ACCOUNT_ID}` });

    const vpc = new ec2.Vpc(this, 'VPC', { natGateways: 1 });

    // 'ALTER DATABASE' is not currently supported in Babelfish
    //const engine = rds.DatabaseClusterEngine.auroraPostgres({
    //  version: rds.AuroraPostgresEngineVersion.VER_13_4,
    //});
    //const parameterGroup = new rds.ParameterGroup(this, 'Babelfish', {
    //  engine,
    //  description: 'Babelfish cluster parameter group for aurora-postgresql13',
    //  parameters: {
    //    'rds.babelfish_status': 'on'
    //  }
    //});
    //const dbCluster = new rds.DatabaseCluster(this, 'DBCluster', {
    //  engine,
    //  instanceProps: {
    //    vpc,
    //    instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
    //    enablePerformanceInsights: true,
    //  },
    //  parameterGroup,
    //  credentials: rds.Credentials.fromGeneratedSecret('postgres'),
    //  storageEncrypted: true
    //});

    const db = new rds.DatabaseInstance(this, 'DatabaseInstance', {
      engine: rds.DatabaseInstanceEngine.sqlServerEx({
        version: rds.SqlServerEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
      credentials: rds.Credentials.fromGeneratedSecret('sa'),
      enablePerformanceInsights: true,
      vpc,
    });
    new Database(this, 'DefaultDatabase', {
      databaseName: databaseName,
      db: db,
      vpc,
    });

    const fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const coreAccessPoint = new efs.AccessPoint(this, 'CoreAccessPoint', {
      fileSystem,
      path: '/bitwarden/core',
      createAcl: efsAcl,
      posixUser: efsPosixUser,
    });
    const attachmentsAccessPoint = new efs.AccessPoint(this, 'AttachmentsAccessPoint', {
      fileSystem,
      path: '/bitwarden/core/attachments',
      createAcl: efsAcl,
      posixUser: efsPosixUser,
    });
    const identityAccessPoint = new efs.AccessPoint(this, 'IdentityAccessPoint', {
      fileSystem,
      path: '/bitwarden/identity',
      createAcl: efsAcl,
      posixUser: efsPosixUser,
    });
    //const dataprotectionAccessPoint = new efs.AccessPoint(this, 'DataProtectionAccessPoint', {
    //  fileSystem,
    //  path: '/bitwarden/core/aspnet-dataprotection',
    //  createAcl: efsAcl,
    //  posixUser: efsPosixUser,
    //});

    const efsAsset = new s3Asset(this, 'EfsAsset', { path: 'shared-filesystem/bitwarden' });
    const identityServerCertificateBuildProject = new codebuild.Project(this, 'IdentityServerCertificateBuildProject', {
      description: '[Bitwarden] Generate identity certificate',
      source: codebuild.Source.s3({
        bucket: efsAsset.bucket,
        path: efsAsset.s3ObjectKey,
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        privileged: true,
      },
      environmentVariables: {
        LOCAL_UID: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: LOCAL_UID,
        },
        LOCAL_GID: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: LOCAL_GID,
        },
        IDENTITY_CERT_PASSWORD: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: identityServerCertificatePasswordSecret.secretArn,
        },
      },
      vpc,
    });
    identityServerCertificateBuildProject.addFileSystemLocation(codebuild.FileSystemLocation.efs({
      identifier: 'efs',
      location: `${fileSystem.fileSystemId}.efs.${cdk.Aws.REGION}.amazonaws.com:/`,
      mountPoint: '/mnt',
    }));
    identityServerCertificateBuildProject.connections.allowTo(fileSystem, ec2.Port.tcp(2049));

    new cr.AwsCustomResource(this, 'IdentityServerCertificateBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: identityServerCertificateBuildProject.projectName,
          sourceTypeOverride: 'S3',
          sourceLocationOverride: `${efsAsset.s3BucketName}/${efsAsset.s3ObjectKey}`,
          idempotencyToken: path.parse(efsAsset.s3ObjectKey).name,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('build.arn'),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: identityServerCertificateBuildProject.projectName,
          sourceTypeOverride: 'S3',
          sourceLocationOverride: `${efsAsset.s3BucketName}/${efsAsset.s3ObjectKey}`,
          idempotencyToken: path.parse(efsAsset.s3ObjectKey).name,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('build.arn'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
    });

    const globalSettingsSecret = new secretsmanager.Secret(this, 'GlobalSettings', {
      description: '[Bitwarden] Environment Variables',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        generateStringKey: 'internalIdentityKey',
        secretStringTemplate: JSON.stringify({
          sqlServer__connectionString: `Data Source=tcp:${db.dbInstanceEndpointAddress},${db.dbInstanceEndpointPort};Initial Catalog=${databaseName};Persist Security Info=False;User ID=${db.secret?.secretValueFromJson('username')};Password=${db.secret?.secretValueFromJson('password')};MultipleActiveResultSets=False;Connect Timeout=30;Encrypt=True;TrustServerCertificate=True`,
          //sqlServer__connectionString: `Data Source=tcp:${dbCluster.clusterEndpoint.hostname},1433;Initial Catalog=babelfish_db;Persist Security Info=False;User ID=${dbCluster.secret?.secretValueFromJson('username')};Password=${dbCluster.secret?.secretValueFromJson('password')};MultipleActiveResultSets=False;Connect Timeout=30;Encrypt=True;TrustServerCertificate=True`,
          installation__id: globalSettings.installation__id,
          installation__key: globalSettings.installation__key,
          yubico__clientId: globalSettings.yubico__clientId,
          yubico__key: globalSettings.yubico__key,
          disableUserRegistration: globalSettings.disableUserRegistration,
          hibpApiKey: globalSettings.hibpApiKey,
          admins: adminSettings.admins,
        }),
      },
    });

    const globalEnvSecrets: {[key: string]: ecs.Secret} = {
      globalSettings__sqlServer__connectionString: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'sqlServer__connectionString'),
      globalSettings__internalIdentityKey: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'internalIdentityKey'),
      globalSettings__identityServer__certificatePassword: ecs.Secret.fromSecretsManager(identityServerCertificatePasswordSecret),
      globalSettings__oidcIdentityClientKey: ecs.Secret.fromSecretsManager(oidcIdentityClientKeySecret),
      globalSettings__duo__aKey: ecs.Secret.fromSecretsManager(duoAKeySecret),
      // installation
      globalSettings__installation__id: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'installation__id'),
      globalSettings__installation__key: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'installation__key'),
      globalSettings__yubico__clientId: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'yubico__clientId'),
      globalSettings__yubico__key: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'yubico__key'),
      // mail
//      globalSettings__mail__smtp__host: ecs.Secret.fromSecretsManager(smtpSecret, 'endpoint'),
//      globalSettings__mail__smtp__username: ecs.Secret.fromSecretsManager(smtpSecret, 'username'),
//      globalSettings__mail__smtp__password: ecs.Secret.fromSecretsManager(smtpSecret, 'password'),
      // others
      globalSettings__disableUserRegistration: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'disableUserRegistration'),
      globalSettings__hibpApiKey: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'hibpApiKey'),
      adminSettings__admins: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'admins'),
    };

    const environment = new Environment(this, 'App', { namespaceName, vpc });
    environment.securityGroup.connections.allowToDefaultPort(db);
    //environment.securityGroup.connections.allowTo(dbCluster, ec2.Port.tcp(1433), 'Babelfish');
    environment.securityGroup.connections.allowToDefaultPort(fileSystem);

    const gateway = new FargateVirtualGateway(this, 'Gateway', { environment });

    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });
    const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
      protocol: elb.ApplicationProtocol.HTTP,
      port: gateway.listenerPort,
      targets: [gateway.ecsService],
      healthCheck: {
        port: '9901',
        path: '/server_info',
      },
      vpc,
    });
    loadBalancer.connections.allowTo(gateway.ecsService, ec2.Port.tcp(+targetGroup.healthCheck.port!), 'for HealthCheck');
    const listner = loadBalancer.addListener('Listner', {
      port: 80,
      defaultTargetGroups: [targetGroup],
      open: false,
    });

    const cfManagedPrefixList = new ManagedPrefixList(this, 'CloudFrontManagedPrefixList', { managedPrefixListName: 'com.amazonaws.global.cloudfront.origin-facing' });
    loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cfManagedPrefixList.managedPrefixListId), ec2.Port.tcp(80));

    const defaultBehavior: cf.BehaviorOptions = {
      origin: new LoadBalancerV2Origin(loadBalancer, {
        protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80,
      }),
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
    };
    const cdn = new cf.Distribution(this, 'Distribution', {
      comment: 'Bitwarden',
      defaultBehavior,
      additionalBehaviors: {
        '*.css': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.png': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.svg': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.woff': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.woff2': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.js': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
      },
      enableIpv6: true,
      webAclId: (webAclArn === 'REPLACE') ? undefined : webAclArn,
    });

    listner.addAction('app-id', {
      priority: 1,
      conditions: [
        elb.ListenerCondition.pathPatterns([
          '/app-id.json',
        ]),
      ],
      action: elb.ListenerAction.fixedResponse(200, {
        contentType: 'application/json',
        messageBody: JSON.stringify({
          trustedFacets: [
            {
              version: {
                major: 1,
                minor: 0,
              },
              ids: [
                `https://${cdn.distributionDomainName}`,
                'ios:bundle-id:com.8bit.bitwarden',
                'android:apk-key-hash:dUGFzUzf3lmHSLBDBIv+WaFyZMI',
              ],
            },
          ],
        }),
      }),
    });

    const uidEnv = {
      LOCAL_UID: LOCAL_UID,
      LOCAL_GID: LOCAL_GID,
    };
    const globalEnv = {
      ASPNETCORE_ENVIRONMENT: 'Production',
      globalSettings__selfHosted: 'true',
      globalSettings__pushRelayBaseUri: 'https://push.bitwarden.com',
      // mail
//      globalSettings__mail__replyToEmail: `no-reply@${sesIdentity.domainName}`,
//      globalSettings__mail__smtp__port: '587',
//      globalSettings__mail__smtp__ssl: 'false',
//      globalSettings__mail__smtp__startTls: 'true',
//      globalSettings__mail__smtp__trustServer: 'true',
      // directory
      globalSettings__attachment__baseDirectory: '/etc/bitwarden/core/attachments',
      globalSettings__send__baseDirectory: '/etc/bitwarden/core/attachments/send',
      globalSettings__dataProtection__directory: '/etc/bitwarden/core/aspnet-dataprotection',
      // Attachment Base URL
      globalSettings__attachment__baseUrl: `https://${cdn.distributionDomainName}/attachments`,
      globalSettings__send__baseUrl: `https://${cdn.distributionDomainName}/attachments/send`,
      // Base Service URI
      globalSettings__baseServiceUri__vault: `https://${cdn.distributionDomainName}`,
      globalSettings__baseServiceUri__api: `https://${cdn.distributionDomainName}/api`,
      globalSettings__baseServiceUri__notifications: `https://${cdn.distributionDomainName}/notifications`,
      globalSettings__baseServiceUri__identity: `https://${cdn.distributionDomainName}/identity`,
      globalSettings__baseServiceUri__admin: `https://${cdn.distributionDomainName}/admin`,
      // internal Base Service URI
      globalSettings__baseServiceUri__internalVault: `http://web.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalApi: `http://api.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalNotifications: `http://notifications.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalIdentity: `http://identity.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalAdmin: `http://admin.svc.${namespaceName}:5000`,
    };

    const pushService = new ExternalVirtualService(this, 'Push', {
      environment,
      virtualServiceName: 'push.bitwarden.com',
      listenerPort: 443,
    });

    const dbService = new ExternalVirtualService(this, 'Database', {
      environment,
      virtualServiceName: db.dbInstanceEndpointAddress,
      //virtualServiceName: dbCluster.clusterEndpoint.hostname,
      listenerPort: 1433,
      protocol: 'tcp',
    });

    const emailService = new ExternalVirtualService(this, 'Email', {
      environment,
      virtualServiceName: `email-smtp.${this.region}.amazonaws.com`,
      listenerPort: 587,
      protocol: 'tcp',
    });

    const webService = new FargateVirtualService(this, 'Web', {
      environment,
      virtualServiceName: `web.svc.${namespaceName}`,
      healthCheckPath: '/',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/web:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });

    const attachmentsService = new FargateVirtualService(this, 'Attachments', {
      environment,
      virtualServiceName: `attachments.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/attachments:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });
    attachmentsService.addVolume(attachmentsAccessPoint, globalEnv.globalSettings__attachment__baseDirectory, 'readOnly');

    const identityService = new FargateVirtualService(this, 'Identity', {
      environment,
      virtualServiceName: `identity.svc.${namespaceName}`,
      healthCheckPath: '/.well-known/openid-configuration',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/identity:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    identityService.addVolume(coreAccessPoint, '/etc/bitwarden/core');
    identityService.addVolume(identityAccessPoint, '/etc/bitwarden/identity');

    const apiService = new FargateVirtualService(this, 'Api', {
      environment,
      virtualServiceName: `api.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/api:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    apiService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const ssoService = new FargateVirtualService(this, 'SSO', {
      environment,
      virtualServiceName: `sso.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/sso:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    ssoService.addVolume(coreAccessPoint, '/etc/bitwarden/core');
    ssoService.addVolume(identityAccessPoint, '/etc/bitwarden/identity');

    const adminService = new FargateVirtualService(this, 'Admin', {
      environment,
      virtualServiceName: `admin.svc.${namespaceName}`,
      healthCheckPath: '/admin/login/',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/admin:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    adminService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const portalService = new FargateVirtualService(this, 'Portal', {
      environment,
      virtualServiceName: `portal.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/portal:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    portalService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const iconsService = new FargateVirtualService(this, 'Icons', {
      environment,
      virtualServiceName: `icons.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/icons:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });
    iconsService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const notificationsService = new FargateVirtualService(this, 'Notifications', {
      environment,
      virtualServiceName: `notifications.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/notifications:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    notificationsService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const eventsService = new FargateVirtualService(this, 'Events', {
      environment,
      virtualServiceName: `events.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('983035974902.dkr.ecr.us-west-2.amazonaws.com/bitwarden/events:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalEnvSecrets,
      },
    });
    eventsService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    apiService.addBackends([dbService, emailService, webService, notificationsService, identityService, adminService]);
    identityService.addBackends([dbService, webService, apiService, notificationsService, adminService]);
    ssoService.addBackends([dbService, webService, apiService, notificationsService, identityService, adminService]);
    adminService.addBackends([dbService, emailService, webService, apiService, notificationsService, identityService]);
    portalService.addBackends([dbService, webService, apiService, notificationsService, identityService, adminService]);
    notificationsService.addBackends([dbService, emailService, pushService, webService, apiService, identityService, adminService]);
    eventsService.addBackends([dbService, emailService, pushService, webService, apiService, notificationsService, identityService, adminService]);

    gateway.addGatewayRoute(webService, '/' );
    gateway.addGatewayRoute(attachmentsService, '/attachments/' );
    gateway.addGatewayRoute(apiService, '/api/' );
    gateway.addGatewayRoute(iconsService, '/icons/' );
    gateway.addGatewayRoute(notificationsService, '/notifications/' );
    gateway.addGatewayRoute(eventsService, '/events/' );
    // need to add rewrite options, but no supported by cdk
    gateway.addGatewayRoute(identityService, '/identity/', '/identity/');
    gateway.addGatewayRoute(ssoService, '/sso/', '/sso/');
    gateway.addGatewayRoute(portalService, '/portal/', '/portal/');
    gateway.addGatewayRoute(adminService, '/admin/', '/admin/');

    this.exportValue(cdn.distributionDomainName, { name: 'BitwardenDistributionDomain' });

  };
};
