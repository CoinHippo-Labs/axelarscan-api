# Axelarscan API

## API Endpoints
- mainnet: [https://api.axelarscan.io](https://api.axelarscan.io)
- testnet: [https://testnet.api.axelarscan.io](https://testnet.gmp.axelarscan.io)

## Deployment
### Prerequisites
1. [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-prereqs.html)
2. [Configuring the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html)
3. [Install terraform](https://learn.hashicorp.com/tutorials/terraform/install-cli)

```bash
yarn
cd ./terraform/testnet
terraform init
terraform apply
```