terraform {
  backend "s3" {
    bucket = "axelar-terraform"
    key    = "services/axelarscan/mainnet/terraform.tfstate"
    region = "us-east-2"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.31"
    }
  }
  required_version = ">= 1.6.6"
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

locals {
  url_subpath_api_mapping = "api" # map apigw to url subpath /api from aws_api_gateway_domain_name
}

data "aws_api_gateway_domain_name" "mainnet" {
  domain_name = "api.axelarscan.io"
}

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
  runtime          = "nodejs20.x"
  timeout          = 840
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
  provisioned_concurrent_executions = 50
  qualifier                         = aws_lambda_function.function.version
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
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

resource "aws_apigatewayv2_route" "route_method" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{method}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "mainnet" {
  api_id      = aws_apigatewayv2_api.api.id
  auto_deploy = true
  name        = var.environment
}

resource "aws_apigatewayv2_api_mapping" "mainnet" {
  api_id          = aws_apigatewayv2_api.api.id
  domain_name     = data.aws_api_gateway_domain_name.mainnet.id
  stage           = aws_apigatewayv2_stage.mainnet.id
  api_mapping_key = local.url_subpath_api_mapping
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = "${var.package_name}-${var.environment}-rule"
  schedule_expression = "cron(*/2 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "target" {
  rule      = aws_cloudwatch_event_rule.schedule.name
  target_id = aws_lambda_function.function.id
  arn       = aws_lambda_function.function.arn
}
