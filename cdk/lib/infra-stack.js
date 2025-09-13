const cdk = require('aws-cdk-lib');
const eks = require('aws-cdk-lib/aws-eks');
const ec2 = require('aws-cdk-lib/aws-ec2');
const ecr = require('aws-cdk-lib/aws-ecr');
const iam = require('aws-cdk-lib/aws-iam');
const s3 = require('aws-cdk-lib/aws-s3');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const { Construct } = require('constructs');

class InfraStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 });

        // ECR repo for the app image
        const repo = new ecr.Repository(this, 'EcrRepo', {
            repositoryName: 'node-api'
        });

        // DynamoDB
        const table = new dynamodb.Table(this, 'ItemsTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        // EKS Cluster
        const cluster = new eks.Cluster(this, 'EksCluster', {
            vpc,
            defaultCapacity: 2,
            version: eks.KubernetesVersion.V1_30,
        });

        // Grant nodes access to read/write Dynamo and pull from ECR
        repo.grantPull(cluster.defaultNodegroup?.role || cluster.defaultCapacity?.role);
        table.grantReadWriteData(cluster.defaultNodegroup?.role || cluster.defaultCapacity?.role);

        // Apply k8s manifests (deployment + service). Replace image later in CI when pushing to ECR.
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
                        containers: [{ name: 'node-api', image: repo.repositoryUriForTag('latest'), ports: [{ containerPort: 3000 }], env: [{ name: 'TABLE_NAME', value: table.tableName }, { name: 'AWS_REGION', value: this.region }] }]
                    }
                }
            }
        };

        cluster.addManifest('AppDeployment', manifestDeployment);

        const svc = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'node-api-svc' },
            spec: { type: 'NodePort', selector: { app: 'node-api' }, ports: [{ port: 3000, targetPort: 3000 }] }
        };

        cluster.addManifest('AppService', svc);

        new cdk.CfnOutput(this, 'EcrRepoUri', { value: repo.repositoryUri });
        new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
        new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    }
}

module.exports = { InfraStack };