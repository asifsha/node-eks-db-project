kubectl create serviceaccount node-api-sa              

kubectl create clusterrolebinding node-api-sa-binding \
  --clusterrole=cluster-admin \
  --serviceaccount=default:node-api-sa