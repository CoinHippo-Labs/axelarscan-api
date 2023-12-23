terraform {
  backend "s3" {
    bucket = "axelar-terraform"
    key    = "services/axelarscan/stagenet/terraform.tfstate"
    region = "us-east-2"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.14"
    }
  }
  required_version = ">= 1.0.0"
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Owner       = "Axelarscan"
      Environment = var.environment
      Terraform   = true
    }
  }
}

provider "archive" {}

data "archive_file" "zip" {
  type        = "zip"
  source_dir  = "../../"
  excludes    = ["terraform", ".gitignore", "README.md", "LICENSE", "yarn.lock", ".env.example", ".env", "test"]
  output_path = "${var.package_name}.zip"
}

data "aws_iam_policy_document" "policy" {
  statement {
    sid     = ""
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      identifiers = ["lambda.amazonaws.com"]
      type        = "Service"
    }
  }
}

data "aws_iam_role" "role" {
  name = var.iam_role
}

resource "aws_iam_policy_attachment" "attachment" {
  name       = "${var.project_name}-attachment"
  roles      = [data.aws_iam_role.role.name]
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "function" {
  function_name    = "${var.package_name}-${var.environment}"
  filename         = data.archive_file.zip.output_path
  source_code_hash = data.archive_file.zip.output_base64sha256
  role             = data.aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 30
  memory_size      = 512
  publish          = true
  environment {
    variables = {
      NODE_NO_WARNINGS = 1
      ENVIRONMENT      = var.environment
      INDEXER_URL      = var.indexer_url
      INDEXER_USERNAME = var.indexer_username
      INDEXER_PASSWORD = var.indexer_password
      LOG_LEVEL        = var.log_level
    }
  }
  kms_key_arn = ""
}

resource "aws_lambda_provisioned_concurrency_config" "config" {
  function_name                     = aws_lambda_function.function.function_name
  provisioned_concurrent_executions = 25
  qualifier                         = aws_lambda_function.function.version
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.package_name}-${var.environment}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_headers = ["*"]
    allow_methods = ["*"]
  }
  route_key = "ANY /${aws_lambda_function.function.function_name}"
  target    = aws_lambda_function.function.arn
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  connection_type        = "INTERNET"
  description            = "Lambda Integration - terraform"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.function.invoke_arn
  integration_type       = "AWS_PROXY"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}
