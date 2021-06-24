import * as path from 'path';

import * as acm from '@aws-cdk/aws-certificatemanager';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as efs from '@aws-cdk/aws-efs';
import * as elb from '@aws-cdk/aws-elasticloadbalancingv2';
import * as rds from '@aws-cdk/aws-rds';
import * as route53 from '@aws-cdk/aws-route53';
import { LoadBalancerTarget } from '@aws-cdk/aws-route53-targets';
import { Asset as s3Asset } from '@aws-cdk/aws-s3-assets';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';

import { SmtpSecret, ManagedIdentity } from 'cdk-ses-helpers';

import { Environment, FargateVirtualGateway, ExternalVirtualService, FargateVirtualService } from './appmesh-for-ecs-fargate';
import { WAF } from './aws-waf-v2'
import { domainSettings, globalSettings, adminSettings } from './settings';
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
  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps = {}) {
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

    const smtpSecret = new SmtpSecret(this, 'SmtpSecret', { sesRegion: this.region });
    const sesIdentity = new ManagedIdentity(this, 'SesIdentity', { sesRegion: this.region });

    const vpc = new ec2.Vpc(this, 'VPC', { natGateways: 1 });

    const db = new rds.DatabaseInstance(this, 'DatabaseInstance', {
      engine: rds.DatabaseInstanceEngine.sqlServerEx({
        version: rds.SqlServerEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
      credentials: rds.Credentials.fromGeneratedSecret('sa'),
      vpc,
    });
    new Database(this, 'DefaultDatabase', {
      db: db,
      databaseName: databaseName,
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
      path: '/bitwarden/attachments',
      createAcl: efsAcl,
      posixUser: efsPosixUser,
    });
    const identityAccessPoint = new efs.AccessPoint(this, 'IdentityAccessPoint', {
      fileSystem,
      path: '/bitwarden/identity',
      createAcl: efsAcl,
      posixUser: efsPosixUser,
    });

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
        generateStringKey: 'globalSettings__internalIdentityKey',
        secretStringTemplate: JSON.stringify({
          globalSettings__sqlServer__connectionString: `Data Source=tcp:${db.dbInstanceEndpointAddress},${db.dbInstanceEndpointPort};Initial Catalog=${databaseName};Persist Security Info=False;User ID=${db.secret?.secretValueFromJson('username')};Password=${db.secret?.secretValueFromJson('password')};MultipleActiveResultSets=False;Connect Timeout=30;Encrypt=True;TrustServerCertificate=True`,
          globalSettings__installation__id: globalSettings.globalSettings__installation__id,
          globalSettings__installation__key: globalSettings.globalSettings__installation__key,
          globalSettings__yubico__clientId: globalSettings.globalSettings__yubico__clientId,
          globalSettings__yubico__key: globalSettings.globalSettings__yubico__key,
          globalSettings__disableUserRegistration: globalSettings.globalSettings__disableUserRegistration,
          globalSettings__hibpApiKey: globalSettings.globalSettings__hibpApiKey,
          adminSettings__admins: adminSettings.adminSettings__admins,
        }),
      },
    });

    const globalOverrideEnv: {[key: string]: ecs.Secret} = {
      globalSettings__sqlServer__connectionString: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__sqlServer__connectionString'),
      globalSettings__internalIdentityKey: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__internalIdentityKey'),
      globalSettings__identityServer__certificatePassword: ecs.Secret.fromSecretsManager(identityServerCertificatePasswordSecret),
      globalSettings__oidcIdentityClientKey: ecs.Secret.fromSecretsManager(oidcIdentityClientKeySecret),
      globalSettings__duo__aKey: ecs.Secret.fromSecretsManager(duoAKeySecret),
      // installation
      globalSettings__installation__id: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__installation__id'),
      globalSettings__installation__key: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__installation__key'),
      globalSettings__yubico__clientId: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__yubico__clientId'),
      globalSettings__yubico__key: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__yubico__key'),
      // mail
      globalSettings__mail__smtp__host: ecs.Secret.fromSecretsManager(smtpSecret, 'endpoint'),
      globalSettings__mail__smtp__username: ecs.Secret.fromSecretsManager(smtpSecret, 'username'),
      globalSettings__mail__smtp__password: ecs.Secret.fromSecretsManager(smtpSecret, 'password'),
      // others
      globalSettings__disableUserRegistration: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__disableUserRegistration'),
      globalSettings__hibpApiKey: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'globalSettings__hibpApiKey'),
      adminSettings__admins: ecs.Secret.fromSecretsManager(globalSettingsSecret, 'adminSettings__admins'),
    };

    const uidEnv = {
      LOCAL_UID: LOCAL_UID,
      LOCAL_GID: LOCAL_GID,
    };
    const baseServiceUri__vault = `https://${domainSettings.subDomainName}.${domainSettings.zoneDomainName}`
    const globalEnv = {
      ASPNETCORE_ENVIRONMENT: 'Production',
      globalSettings__selfHosted: 'true',
      globalSettings__pushRelayBaseUri: 'https://push.bitwarden.com',
      // mail
      globalSettings__mail__replyToEmail: `no-reply@${sesIdentity.domainName}`,
      globalSettings__mail__smtp__port: '587',
      globalSettings__mail__smtp__ssl: 'false',
      globalSettings__mail__smtp__startTls: 'true',
      globalSettings__mail__smtp__trustServer: 'true',
      // Base Service URI
      globalSettings__baseServiceUri__vault: baseServiceUri__vault,
      globalSettings__baseServiceUri__api: `${baseServiceUri__vault}/api`,
      globalSettings__baseServiceUri__notifications: `${baseServiceUri__vault}/notifications`,
      globalSettings__baseServiceUri__identity: `${baseServiceUri__vault}/identity`,
      globalSettings__baseServiceUri__admin: `${baseServiceUri__vault}/admin`,
      // internal Base Service URI
      globalSettings__baseServiceUri__internalVault: `http://web.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalApi: `http://api.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalNotifications: `http://notifications.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalIdentity: `http://identity.svc.${namespaceName}:5000`,
      globalSettings__baseServiceUri__internalAdmin: `http://admin.svc.${namespaceName}:5000`,
    };

    const environment = new Environment(this, 'App', { namespaceName, vpc });
    environment.securityGroup.connections.allowToDefaultPort(db);
    environment.securityGroup.connections.allowToDefaultPort(fileSystem);

    const pushService = new ExternalVirtualService(this, 'Push', {
      environment,
      virtualServiceName: 'push.bitwarden.com',
      listenerPort: 443,
    });

    const dbService = new ExternalVirtualService(this, 'Database', {
      environment,
      virtualServiceName: db.dbInstanceEndpointAddress,
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
        image: ecs.ContainerImage.fromRegistry('bitwarden/web:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });

    const attachmentsService = new FargateVirtualService(this, 'Attachments', {
      environment,
      virtualServiceName: `attachments.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/attachments:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });
    attachmentsService.addVolume(attachmentsAccessPoint, '/etc/bitwarden/core/attachments');

    const identityService = new FargateVirtualService(this, 'Identity', {
      environment,
      virtualServiceName: `identity.svc.${namespaceName}`,
      healthCheckPath: '/.well-known/openid-configuration',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/identity:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });
    identityService.addVolume(coreAccessPoint, '/etc/bitwarden/core');
    identityService.addVolume(identityAccessPoint, '/etc/bitwarden/identity');

    const apiService = new FargateVirtualService(this, 'Api', {
      environment,
      virtualServiceName: `api.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/api:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });
    apiService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const ssoService = new FargateVirtualService(this, 'SSO', {
      environment,
      virtualServiceName: `sso.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/sso:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });
    ssoService.addVolume(coreAccessPoint, '/etc/bitwarden/core');
    ssoService.addVolume(identityAccessPoint, '/etc/bitwarden/identity');

    const adminService = new FargateVirtualService(this, 'Admin', {
      environment,
      virtualServiceName: `admin.svc.${namespaceName}`,
      healthCheckPath: '/admin/login/',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/admin:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
      desiredCount: 1,
    });
    adminService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const portalService = new FargateVirtualService(this, 'Portal', {
      environment,
      virtualServiceName: `portal.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/portal:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });
    portalService.addVolume(coreAccessPoint, '/etc/bitwarden/core');

    const iconsService = new FargateVirtualService(this, 'Icons', {
      environment,
      virtualServiceName: `icons.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/icons:latest'),
        environment: { ...uidEnv, ...globalEnv },
      },
    });

    const notificationsService = new FargateVirtualService(this, 'Notifications', {
      environment,
      virtualServiceName: `notifications.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/notifications:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });

    const eventsService = new FargateVirtualService(this, 'Events', {
      environment,
      virtualServiceName: `events.svc.${namespaceName}`,
      healthCheckPath: '/alive',
      applicationContainer: {
        image: ecs.ContainerImage.fromRegistry('bitwarden/events:latest'),
        environment: { ...uidEnv, ...globalEnv },
        secrets: globalOverrideEnv,
      },
    });
    
    const gateway = new FargateVirtualGateway(this, 'Gateway', { environment });

    apiService.addBackends([dbService, emailService, webService, notificationsService, identityService, adminService]);
    identityService.addBackends([dbService, webService, apiService, notificationsService, adminService]);
    ssoService.addBackends([dbService, webService, apiService, notificationsService, identityService, adminService]);
    adminService.addBackends([dbService, emailService, webService, apiService, notificationsService, identityService]);
    portalService.addBackends([dbService, webService, apiService, notificationsService, identityService, adminService]);
    notificationsService.addBackends([dbService, emailService, pushService, webService, apiService, identityService, adminService]);
    eventsService.addBackends([dbService, emailService, pushService, webService, apiService, notificationsService, identityService, adminService]);

    gateway.addGatewayRoute('/', webService);
    gateway.addGatewayRoute('/attachments/', attachmentsService);
    gateway.addGatewayRoute('/api/', apiService);
    gateway.addGatewayRoute('/icons/', iconsService);
    gateway.addGatewayRoute('/notifications/', notificationsService);
    gateway.addGatewayRoute('/events/', eventsService);
    // need to add rewrite options
    gateway.addGatewayRoute('/sso/', ssoService);
    gateway.addGatewayRoute('/identity/', identityService);
    gateway.addGatewayRoute('/admin/', adminService);
    gateway.addGatewayRoute('/portal/', portalService);

    const hostedZone = (domainSettings.zoneDomainName !== 'example.com')
      ? route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: domainSettings.zoneDomainName })
      : undefined ;

    const certificate = (hostedZone)
      ? new acm.DnsValidatedCertificate(this, 'Certificate', { domainName: [domainSettings.subDomainName, domainSettings.zoneDomainName].join('.'), hostedZone: hostedZone })
      : undefined ;

    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });
    loadBalancer.connections.allowTo(gateway.ecsService, ec2.Port.tcp(9901), 'for HealthCheck');
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
    const listner = loadBalancer.addListener('Listner', {
      port: (certificate) ? 443 : 80,
      certificates: (certificate) ? [certificate] : [],
      defaultTargetGroups: [targetGroup]
    });
    listner.addAction('app-id', {
      priority: 1,
      conditions: [
        elb.ListenerCondition.pathPatterns([
          '/app-id.json'
        ])
      ],
      action: elb.ListenerAction.fixedResponse(200, {
        contentType: 'application/json',
        messageBody: JSON.stringify({
          "trustedFacets": [
            {
              "version": {
                "major": 1,
                "minor": 0
              },
              "ids": [
                baseServiceUri__vault,
                "ios:bundle-id:com.8bit.bitwarden",
                "android:apk-key-hash:dUGFzUzf3lmHSLBDBIv+WaFyZMI"
              ]
            }
          ]
        })
      })
    });

    new WAF(this, 'BitwardenWAF', { resourceArn: loadBalancer.loadBalancerArn })

    if (hostedZone) {
      new route53.ARecord(this, 'ARecord', {
        zone: hostedZone,
        recordName: domainSettings.subDomainName,
        target: { aliasTarget: new LoadBalancerTarget(loadBalancer) },
      });
    };

  };
};
