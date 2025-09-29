# Node.js API on Amazon EKS

This project demonstrates deploying a **Node.js API** onto an **Amazon EKS (Elastic Kubernetes Service)** cluster using Kubernetes manifests. It includes configuration for pods, service accounts, deployments, and services to run the application on AWS-managed Kubernetes.

---

## 🚀 Project Overview

* **Backend:** Node.js + Express
* **Containerization:** Docker
* **Orchestration:** Kubernetes (EKS)
* **Cloud Provider:** AWS
* **Networking:** Exposes API via Kubernetes `Service` (LoadBalancer / ClusterIP)

---

## 📂 Repository Structure

```
.
├── Dockerfile               # Builds the Node.js API container image
├── k8s/
│   ├── deployment.yaml      # Deployment manifest for Node.js API
│   ├── service.yaml         # Service manifest (LoadBalancer or ClusterIP)
│   ├── serviceaccount.yaml  # Service account definition
│   └── namespace.yaml       # (Optional) Namespace for the app
├── src/
│   ├── index.js             # Main Express server
│   └── ...                  # Other Node.js API files
└── README.md
```

---

## ⚙️ Prerequisites

Before deploying, ensure you have:

* [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
* [kubectl](https://kubernetes.io/docs/tasks/tools/)
* [eksctl](https://eksctl.io/) (optional but recommended)
* Docker installed locally
* An **EKS cluster** with worker nodes (node group must be `Active`)

---

## 🛠️ Setup & Deployment

### 1. Clone this repository

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Build and push the Docker image

Replace `<account_id>`, `<region>`, and `<repo-name>` with your details.

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account_id>.dkr.ecr.<region>.amazonaws.com

# Build and tag the image
docker build -t node-api .

# Tag for ECR
docker tag node-api:latest <account_id>.dkr.ecr.<region>.amazonaws.com/<repo-name>:latest

# Push to ECR
docker push <account_id>.dkr.ecr.<region>.amazonaws.com/<repo-name>:latest
```
