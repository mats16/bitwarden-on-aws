import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as wafv2 from '@aws-cdk/aws-wafv2';
import * as cdk from '@aws-cdk/core';

interface OriginWafProps {
  resourceArn: string;
  customHeaderKey: string;
}

export class OriginWaf extends cdk.Construct {
  customHeaderValue: string;

  constructor(scope: cdk.Construct, id: string, props: OriginWafProps) {
    super(scope, id);

    this.customHeaderValue = new secretsmanager.Secret(this, 'OriginCustomHeaderValue', {
      description: '[Bitwarden] CloudFront origin custom header',
      generateSecretString: {
        passwordLength: 50,
        excludePunctuation: true,
      },
    }).secretValue.toString();

    const webACL = new wafv2.CfnWebACL(this, 'WebACL', {
      description: 'Allow from CloudFront',
      scope: 'REGIONAL',
      rules: [
        {
          name: 'VerifyCloudFrontOriginCustomHeaderRule',
          priority: 0,
          statement: {
            notStatement: {
              statement: {
                byteMatchStatement: {
                  fieldToMatch: {
                    singleHeader: {
                      name: props.customHeaderKey
                    }
                  },
                  searchString: this.customHeaderValue,
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'NONE'
                    }
                  ],
                  positionalConstraint: 'EXACTLY'
                }  
              }
            },
          },
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'VerifyCloudFrontOriginCustomHeaderRule',
          },
        },
      ],
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'Bitwarden-Origin-WebACL',
        sampledRequestsEnabled: false,
      },
    });
    new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
      webAclArn: webACL.attrArn,
      resourceArn: props.resourceArn,
    })
  };
};
