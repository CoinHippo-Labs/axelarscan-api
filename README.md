# Axelarscan API

## Endpoints
- [https://api.axelarscan.io](https://api.axelarscan.io)
- [https://testnet.api.axelarscan.io](https://testnet.api.axelarscan.io)

## Stacks
- AWS Opensearch
- AWS Lambda
- AWS API Gateway
- AWS EventBridge
- Docker Compose
- Node.js

## Deployment
### Prerequisites
1. [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-prereqs.html)
2. [Configuring the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html)
3. [Install npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
4. [Install jq](https://stedolan.github.io/jq)
5. [Setup agent](/agent)

```
# modify the execution permission
chmod +x scripts/deploy.sh

# help
./scripts/deploy.sh --help
```

### Deploy services
```
./scripts/deploy.sh --environment testnet --aws-region {AWS_REGION}
```
