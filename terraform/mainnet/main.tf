terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.14"
    }
  }
  required_version = ">= 1.0.0"
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "archive" {}

data "archive_file" "zip_api" {
  type        = "zip"
  source_dir  = "../../functions/api"
  excludes    = ["yarn.lock"]
  output_path = "${var.project_name}-api.zip"
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
  name = "${var.project_name}-role-lambda"
}

resource "aws_iam_policy_attachment" "attachment" {
  name       = "${var.project_name}-attachment"
  roles      = [data.aws_iam_role.role.name]
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-${var.environment}"
  filename         = data.archive_file.zip_api.output_path
  source_code_hash = data.archive_file.zip_api.output_base64sha256
  role             = data.aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  timeout          = 30
  memory_size      = 512
  environment {
    variables = {
      NODE_NO_WARNINGS           = 1
      ENVIRONMENT                = var.environment
      GENERAL_INDEXER_URL        = var.general_indexer_url
      GENERAL_INDEXER_USERNAME   = var.general_indexer_username
      GENERAL_INDEXER_PASSWORD   = var.general_indexer_password
      TRANSFERS_INDEXER_URL      = var.transfers_indexer_url
      TRANSFERS_INDEXER_USERNAME = var.transfers_indexer_username
      TRANSFERS_INDEXER_PASSWORD = var.transfers_indexer_password
      LOG_LEVEL                  = var.log_level
    }
  }
  kms_key_arn      = ""
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-${var.environment}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_headers = ["*"]
    allow_methods = ["*"]
  }
  route_key     = "ANY /${aws_lambda_function.api.function_name}"
  target        = aws_lambda_function.api.arn
}

resource "aws_apigatewayv2_route" "route_default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /"
  target    = "integrations/${var.api_gateway_integration_id}"
}

resource "aws_apigatewayv2_route" "route_cross-chain" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /cross-chain/{function}"
  target    = "integrations/${var.api_gateway_integration_id}"
}

resource "aws_apigatewayv2_route" "route_function" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{function}"
  target    = "integrations/${var.api_gateway_integration_id}"
}

data "archive_file" "zip_axelar_crawler" {
  type        = "zip"
  source_dir  = "../../functions/axelar-crawler"
  excludes    = ["yarn.lock"]
  output_path = "${var.project_name}-axelar-crawler.zip"
}

resource "aws_lambda_function" "axelar_crawler" {
  function_name    = "${var.project_name}-axelar-crawler-${var.environment}"
  filename         = data.archive_file.zip_axelar_crawler.output_path
  source_code_hash = data.archive_file.zip_axelar_crawler.output_base64sha256
  role             = data.aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  timeout          = 630
  memory_size      = 1536
  environment {
    variables = {
      NODE_NO_WARNINGS = 1
      ENVIRONMENT      = var.environment
      LOG_LEVEL        = var.log_level
    }
  }
  kms_key_arn      = ""
}

resource "aws_cloudwatch_event_rule" "schedule_axelar_crawler" {
  name                = "${var.project_name}-axelar-crawler-${var.environment}-rule"
  schedule_expression = "cron(*/10 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "target_axelar_crawler" {
  rule      = aws_cloudwatch_event_rule.schedule_axelar_crawler.name
  target_id = aws_lambda_function.axelar_crawler.id
  arn       = aws_lambda_function.axelar_crawler.arn
}

data "archive_file" "zip_evm_crawler" {
  type        = "zip"
  source_dir  = "../../functions/evm-crawler"
  excludes    = ["yarn.lock"]
  output_path = "${var.project_name}-evm-crawler.zip"
}

resource "aws_lambda_function" "evm_crawler" {
  function_name    = "${var.project_name}-evm-crawler-${var.environment}"
  filename         = data.archive_file.zip_evm_crawler.output_path
  source_code_hash = data.archive_file.zip_evm_crawler.output_base64sha256
  role             = data.aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  timeout          = 630
  memory_size      = 1536
  environment {
    variables = {
      NODE_NO_WARNINGS = 1
      ENVIRONMENT      = var.environment
      LOG_LEVEL        = var.log_level
    }
  }
  kms_key_arn      = ""
}

resource "aws_cloudwatch_event_rule" "schedule_evm_crawler" {
  name                = "${var.project_name}-evm-crawler-${var.environment}-rule"
  schedule_expression = "cron(*/10 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "target_evm_crawler" {
  rule      = aws_cloudwatch_event_rule.schedule_evm_crawler.name
  target_id = aws_lambda_function.evm_crawler.id
  arn       = aws_lambda_function.evm_crawler.arn
}

data "archive_file" "zip_tvl" {
  type        = "zip"
  source_dir  = "../../functions/tvl"
  excludes    = ["yarn.lock"]
  output_path = "${var.project_name}-tvl.zip"
}

resource "aws_lambda_function" "tvl" {
  function_name    = "${var.project_name}-tvl-${var.environment}"
  filename         = data.archive_file.zip_tvl.output_path
  source_code_hash = data.archive_file.zip_tvl.output_base64sha256
  role             = data.aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  timeout          = 240
  memory_size      = 1024
  environment {
    variables = {
      NODE_NO_WARNINGS = 1
      ENVIRONMENT      = var.environment
      LOG_LEVEL        = var.log_level
    }
  }
  kms_key_arn      = ""
}

resource "aws_cloudwatch_event_rule" "schedule_tvl" {
  name                = "${var.project_name}-tvl-${var.environment}-rule"
  schedule_expression = "cron(*/3 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "target_tvl" {
  rule      = aws_cloudwatch_event_rule.schedule_tvl.name
  target_id = aws_lambda_function.tvl.id
  arn       = aws_lambda_function.tvl.arn
}