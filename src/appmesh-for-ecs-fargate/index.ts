export * from './environment';
export * from './viratual-service';
export * from './viratual-gateway';

import { ContainerImage } from '@aws-cdk/aws-ecs';

export const envoyImage = ContainerImage.fromRegistry('public.ecr.aws/appmesh/aws-appmesh-envoy:v1.18.3.0-prod');
export const xrayImage = ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest');
export const cloudwatchImage = ContainerImage.fromRegistry('public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest');
