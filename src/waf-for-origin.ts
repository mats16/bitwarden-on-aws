import * as wafv2 from '@aws-cdk/aws-wafv2';
import * as cdk from '@aws-cdk/core';

interface OriginWafProps {
  preSharedKeyValue: string;
  resourceArn: string,
};

export class OriginWaf extends cdk.Construct {

  constructor(scope: cdk.Construct, id: string, props: OriginWafProps) {
    super(scope, id);

    const webACL = new wafv2.CfnWebACL(this, 'WebACL', {
      scope: 'REGIONAL',
      rules: [
        {
          name: 'VerifyCloudFrontOriginCustomHeaderRule',
          priority: 0,
          statement: {
            byteMatchStatement: {
              fieldToMatch: {
                singleHeader: {
                  name: 'X-Pre-Shared-Key'
                }
              },
              searchString: props.preSharedKeyValue,
              textTransformations: [
                {
                  priority: 0,
                  type: 'NONE'
                }
              ],
              positionalConstraint: 'EXACTLY'
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'VerifyCloudFrontOriginCustomHeaderRule',
          },
        },
      ],
      defaultAction: { block: {} },
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
