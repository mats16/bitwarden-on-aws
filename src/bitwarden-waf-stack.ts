import * as wafv2 from '@aws-cdk/aws-wafv2';
import * as cdk from '@aws-cdk/core';

export class BitwardenWafStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const webACL = new wafv2.CfnWebACL(this, 'BitwardenWebACL', {
      description: 'self-hosted Bitwarden Web ACL',
      scope: 'CLOUDFRONT',
      rules: [
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
          },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          },
        },
        {
          name: 'AWS-AWSManagedRulesSQLiRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesSQLiRuleSet',
          },
        },
        {
          name: 'Bitwarden-GetIconsRule',
          priority: 3,
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: '/icons/',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                    
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { method: {} },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'GET',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                  }
                }
              ]
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: false,
            cloudWatchMetricsEnabled: false,
            metricName: 'Bitwarden-GetIconsRule',
          },
        },
        {
          name: 'Bitwarden-PostSendFileRule',
          priority: 4,
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: '/api/sends/',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { method: {} },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'POST',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                  }
                },
              ]
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: false,
            cloudWatchMetricsEnabled: false,
            metricName: 'Bitwarden-PostSendFileRule',
          },
        },
        {
          name: 'Bitwarden-GetSendFileRule',
          priority: 5,
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: '/attachments/send/',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { method: {} },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'GET',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                  }
                },
              ]
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: false,
            cloudWatchMetricsEnabled: false,
            metricName: 'Bitwarden-GetSendFileRule',
          },
        },
        {
          name: 'Bitwarden-WebAuthnRule',
          priority: 6,
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: '/webauthn-connector.html',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                    
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { method: {} },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'GET',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }]
                    
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { singleHeader: { name: 'sec-fetch-mode' } },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'navigate',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }] 
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { singleHeader: { name: 'sec-fetch-site' } },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'same-origin',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }] 
                  }
                },
                {
                  byteMatchStatement: {
                    fieldToMatch: { singleHeader: { name: 'sec-fetch-dest' } },
                    positionalConstraint: 'EXACTLY',
                    searchString: 'iframe',
                    textTransformations: [{
                      priority: 0, type: 'NONE'
                    }] 
                  }
                },
              ]
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: false,
            cloudWatchMetricsEnabled: false,
            metricName: 'Bitwarden-WebAuthnRule',
          },
        },
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 7,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesCommonRuleSet',
          },
        },
        {
          name: 'Bitwarden-MobileAppUserAgentRule',
          priority: 8,
          statement:                 {
            byteMatchStatement: {
              fieldToMatch: { singleHeader: { name: 'user-agent' } },
              positionalConstraint: 'STARTS_WITH',
              searchString: 'Bitwarden_Mobile',
              textTransformations: [{
                priority: 0, type: 'NONE'
              }] 
            }
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: false,
            cloudWatchMetricsEnabled: false,
            metricName: 'Bitwarden-MobileAppUserAgentRule',
          },
        },
        {
          name: 'AWS-AWSManagedRulesBotControlRuleSet',
          priority: 9,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesBotControlRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesBotControlRuleSet',
          },
        },
      ],
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-WebACL`,
        sampledRequestsEnabled: false,
      },
      tags: [{
        key: 'cfn-stack-for',
        value: 'BitwardenStack',
      }],
    });

    this.exportValue(webACL.attrArn, { name: 'BitwardenWebAclArn' });

  };
};
