const cdk = require('aws-cdk-lib');
const eks = require('aws-cdk-lib/aws-eks');
const ec2 = require('aws-cdk-lib/aws-ec2');
const ecr = require('aws-cdk-lib/aws-ecr');
const iam = require('aws-cdk-lib/aws-iam');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const { Construct } = require('constructs');

class InfraStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        // VPC with subnet tagging for EKS load balancers
        const vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            subnetConfiguration: [
                { cidrMask: 24, name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC },
                { cidrMask: 24, name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
            ]
        });

        // DynamoDB
        const table = new dynamodb.Table(this, 'ItemsTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        // ECR repo for the app image
        const repo = new ecr.Repository(this, 'EcrRepo', {
            repositoryName: 'node-api'
        });

        // EKS Cluster
        const cluster = new eks.Cluster(this, 'EksCluster', {
            vpc,
            version: eks.KubernetesVersion.V1_30,
            defaultCapacity: 2
        });

        // Tag subnets for ELB usage
        vpc.publicSubnets.forEach((subnet) => {
            cdk.Tags.of(subnet).add('kubernetes.io/role/elb', '1');
            cdk.Tags.of(subnet).add(`kubernetes.io/cluster/${cluster.clusterName}`, 'shared');
        });
        vpc.privateSubnets.forEach((subnet) => {
            cdk.Tags.of(subnet).add('kubernetes.io/role/internal-elb', '1');
            cdk.Tags.of(subnet).add(`kubernetes.io/cluster/${cluster.clusterName}`, 'shared');
        });

        // IRSA Role for node-api
        const nodeApiSa = cluster.addServiceAccount('NodeApiServiceAccount', {
            name: 'node-api-sa',
            namespace: 'default'
        });

        nodeApiSa.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess')
        );
        nodeApiSa.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
        );

        // Grant nodes access to pull from ECR
        repo.grantPull(cluster.defaultNodegroup?.role || cluster.defaultCapacity?.role);
        table.grantReadWriteData(cluster.defaultNodegroup?.role || cluster.defaultCapacity?.role);

        // Apply k8s manifests (deployment + service)
        const manifestDeployment = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'node-api' },
            spec: {
                replicas: 2,
                selector: { matchLabels: { app: 'node-api' } },
                template: {
                    metadata: { labels: { app: 'node-api' } },
                    spec: {
                        serviceAccountName: nodeApiSa.serviceAccountName, // bind IRSA
                        containers: [
                            {
                                name: 'node-api',
                                image: repo.repositoryUriForTag('latest'),
                                ports: [{ containerPort: 3000 }],
                                env: [
                                    { name: 'TABLE_NAME', value: table.tableName },
                                    { name: 'AWS_REGION', value: this.region }
                                ]
                            }
                        ]
                    }
                }
            }
        };

        cluster.addManifest('AppDeployment', manifestDeployment);

        const svc = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'node-api' },
            spec: {
                type: 'LoadBalancer',
                selector: { app: 'node-api' },
                ports: [{ port: 80, targetPort: 3000 }]
            }
        };

        const svcManifest = cluster.addManifest('AppService', svc);

        cluster.awsAuth.addMastersRole(
            iam.Role.fromRoleArn(this, 'DevCliRole',
                'arn:aws:iam::412381746256:role/DevCliRole'
            )
        );

        // Outputs
        new cdk.CfnOutput(this, 'EcrRepoUri', { value: repo.repositoryUri });
        new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
        new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
        new cdk.CfnOutput(this, 'ServiceEndpoint', {
            value: cdk.Fn.join('', [
                'http://',
                svcManifest.getAtt('status.loadBalancer.ingress.0.hostname')
            ])
        });
    }
}

module.exports = { InfraStack };
