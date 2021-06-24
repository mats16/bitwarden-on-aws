import * as wafv2 from '@aws-cdk/aws-wafv2';
import * as cdk from '@aws-cdk/core';

interface WAFProps {
  readonly resourceArn: string;
}
  
export class WAF extends cdk.Construct {
  
  constructor(scope: cdk.Construct, id: string, props: WAFProps) {
    super(scope, id);

    const resourceArn = props.resourceArn;

    const webACL = new wafv2.CfnWebACL(this, 'WebACL', {
      scope: 'REGIONAL',
      rules: [
        {
          name: 'AWS-AWSManagedRulesBotControlRuleSet',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesBotControlRuleSet'
            }
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesBotControlRuleSet'
          },
        },
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList'
            }
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesAmazonIpReputationList'
          },
        },
        {
          name: 'AWS-AWSManagedRulesAdminProtectionRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAdminProtectionRuleSet'
            }
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesAdminProtectionRuleSet'
          },
        },
        {
          name: 'AWS-AWSManagedRulesSQLiRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet'
            }
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesSQLiRuleSet'
          },
        },
      ],
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-WebACL`,
        sampledRequestsEnabled: false
      },
    });

    new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
      resourceArn: resourceArn,
      webAclArn: webACL.attrArn,
    });
  }
}


