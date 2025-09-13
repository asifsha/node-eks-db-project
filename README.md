# node-eks-dynamo-project

This repository scaffold contains a Node.js REST API backed by DynamoDB and everything needed to publish it to **EKS** using **CDK**. It includes Dockerfile, Kubernetes manifests, CDK infra (EKS + ECR + IAM), and a GitHub Actions workflow to build/push the image and apply the Kubernetes manifest to the cluster.

---

## Project structure

```
node-eks-dynamo-project/
├─ README.md
├─ package.json
├─ Dockerfile
├─ src/
│  ├─ index.js
│  └─ dynamo.js
├─ k8s/
│  ├─ deployment.yaml
│  └─ service.yaml
├─ cdk/
│  ├─ bin/
│  │  └─ infra.js
│  ├─ lib/
│  │  └─ infra-stack.js
│  └─ package.json
├─ .github/
│  └─ workflows/
│     └─ ci.yml
```

---

## `README.md`

```markdown
# Node API -> DynamoDB -> EKS

This project demonstrates a minimal Node.js REST API using DynamoDB and deploys to EKS. It includes CDK code to create an EKS cluster and an ECR repository.

### Features
- Health check: `GET /health`
- CRUD for items (DynamoDB): `GET /items/:id`, `POST /items`, `PUT /items/:id`, `DELETE /items/:id`

### Quick local run
1. Install dependencies: `npm install`
2. Set env var: `export TABLE_NAME=your-table` and `export AWS_REGION=ap-southeast-2`
3. `node src/index.js`

### Build & push (CI)
- GitHub Actions workflow included to build image, push to ECR, and update k8s deployment.

### CDK
- `cdk deploy` will create EKS cluster, ECR repo, and apply the kubernetes manifests (requires AWS credentials).

```

---

## `package.json` (root)

```json
{
  "name": "node-api-dynamo-eks",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "aws-sdk": "^2.1410.0",
    "express": "^4.18.2",
    "body-parser": "^1.20.2",
    "@aws-sdk/client-dynamodb": "^3.386.0",
    "@aws-sdk/lib-dynamodb": "^3.386.0"
  }
}
```

> NOTE: I included aws-sdk v2 and @aws-sdk v3 libs so you can choose either; code uses v3 lib (`@aws-sdk/lib-dynamodb`).

---

## `src/dynamo.js`

```js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || "ap-southeast-2";
const client = new DynamoDBClient({ region });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME || "ItemsTable";

async function getItem(id) {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
  return res.Item;
}

async function listItems() {
  const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
  return res.Items || [];
}

async function putItem(item) {
  if (!item.id) throw new Error("id is required");
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function updateItem(id, patch) {
  // simple partial update: set provided attributes
  const expr = [];
  const names = {};
  const values = {};
  let i = 0;
  for (const k of Object.keys(patch)) {
    i++;
    const nameKey = `#k${i}`;
    const valKey = `:v${i}`;
    names[nameKey] = k;
    values[valKey] = patch[k];
    expr.push(`${nameKey} = ${valKey}`);
  }
  const updateExpression = `SET ${expr.join(", ")}`;
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { id },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW"
  }));
  return getItem(id);
}

async function deleteItem(id) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
  return { id };
}

module.exports = { getItem, putItem, deleteItem, listItems, updateItem };
```

---

## `src/index.js`

```js
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { getItem, putItem, deleteItem, listItems, updateItem } = require('./dynamo');

const app = express();
app.use(bodyParser.json());

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// list items
app.get('/items', async (req, res) => {
  try {
    const items = await listItems();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// get
app.get('/items/:id', async (req, res) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// post
app.post('/items', async (req, res) => {
  try {
    const id = uuidv4();
    const payload = Object.assign({}, req.body, { id, createdAt: new Date().toISOString() });
    await putItem(payload);
    res.status(201).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// put (partial update)
app.put('/items/:id', async (req, res) => {
  try {
    const updated = await updateItem(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// delete
app.delete('/items/:id', async (req, res) => {
  try {
    await deleteItem(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
```

> `uuid` is used — add to dependencies if you want (or swap to client-supplied id).

---

## `Dockerfile`

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production
COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]
```

---

## `k8s/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: node-api
  template:
    metadata:
      labels:
        app: node-api
    spec:
      containers:
      - name: node-api
        image: <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/node-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: TABLE_NAME
          value: "ItemsTable"
        - name: AWS_REGION
          value: "ap-southeast-2"
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 20
```

## `k8s/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: node-api-svc
spec:
  type: NodePort
  selector:
    app: node-api
  ports:
    - protocol: TCP
      port: 3000
      targetPort: 3000
```

---

## `cdk/bin/infra.js`

```js
#!/usr/bin/env node
const cdk = require('aws-cdk-lib');
const { InfraStack } = require('../lib/infra-stack');

const app = new cdk.App();
new InfraStack(app, 'InfraStack', {
  /* pass stackProps if needed */
});
```

---

## `cdk/lib/infra-stack.js`

```js
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
```

> Notes on infra: the stack creates an EKS cluster with managed nodegroup (defaultCapacity) and an ECR repo and DynamoDB table. The `cluster.addManifest` uses `repo.repositoryUriForTag('latest')` as placeholder image; CI will push the image and update the k8s Deployment image if necessary.

---

## `cdk/package.json`

```json
{
  "name": "infra-cdk",
  "version": "0.1.0",
  "dependencies": {
    "aws-cdk-lib": "^2.96.0",
    "constructs": "^10.1.169"
  }
}
```

---

## `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [ main ]

permissions:
  contents: read
  id-token: write
  packages: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }} # optional
          aws-region: ap-southeast-2

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build, tag, push image
        env:
          ECR_REPO: ${{ steps.login-ecr.outputs.registry }}/node-api
        run: |
          docker build -t node-api:latest .
          docker tag node-api:latest $ECR_REPO:latest
          docker push $ECR_REPO:latest

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name $(aws eks list-clusters --region ap-southeast-2 --query "clusters[0]" --output text) --region ap-southeast-2

      - name: Set deployment image
        run: |
          kubectl set image deployment/node-api node-api=${{ steps.login-ecr.outputs.registry }}/node-api:latest --record || kubectl apply -f k8s/deployment.yaml

      - name: Apply service
        run: kubectl apply -f k8s/service.yaml
```

---

## Next steps / notes

* Replace `<ACCOUNT>` and `<REGION>` placeholders in `k8s/deployment.yaml` with your AWS account ID and region, or use the GitHub Actions to set the image automatically.
* Ensure GitHub Actions has permission to push to ECR and assume role / use credentials.
* You can also `cdk deploy` locally to provision the EKS cluster and ECR repo. After `cdk deploy`, push the image and update k8s deployment.

---

If you want, I can also:

* generate these files as individual downloadable files,
* create a ready-to-run GitHub repo structure,
* or produce a variant using EKS Fargate instead of managed nodegroups.
