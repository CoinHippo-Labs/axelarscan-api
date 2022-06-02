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

data "archive_file" "zip" {
  type        = "zip"
  source_dir  = "../../functions/api"
  excludes    = ["package-lock.json", "yarn.lock"]
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

resource "aws_iam_role" "role" {
  name               = "${var.package_name}-${var.environment}-role-lambda"
  assume_role_policy = data.aws_iam_policy_document.policy.json
}

resource "aws_iam_policy_attachment" "attachment" {
  name       = "${var.package_name}-${var.environment}-attachment"
  roles      = [aws_iam_role.role.name]
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_opensearch_domain" "domain" {
  domain_name     = "${var.package_name}-general-${var.environment}"
  engine_version  = "OpenSearch_1.2"
  cluster_config {
    instance_type            = "m6g.4xlarge.search"
    instance_count           = 3
    dedicated_master_enabled = false
    zone_awareness_enabled   = false
    warm_enabled             = false
  }
  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = 64
  }
  encrypt_at_rest {
    enabled = true
  }
  node_to_node_encryption {
    enabled = true
  }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }
  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = var.indexer_username
      master_user_password = var.indexer_password
    }
  }
}

resource "aws_opensearch_domain_policy" "main" {
  domain_name = aws_opensearch_domain.domain.domain_name
  access_policies = <<POLICIES
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": ["es:*"],
            "Principal": {
                "AWS" : ["*"]
            },
            "Effect": "Allow",
            "Resource": "${aws_opensearch_domain.domain.arn}/*"
        }
    ]
}
POLICIES
}

resource "aws_opensearch_domain" "domain_transfers" {
  domain_name     = "${var.package_name}-transfers-${var.environment}"
  engine_version  = "OpenSearch_1.2"
  cluster_config {
    instance_type            = "m6g.2xlarge.search"
    instance_count           = 3
    dedicated_master_enabled = false
    zone_awareness_enabled   = false
    warm_enabled             = false
  }
  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = 32
  }
  encrypt_at_rest {
    enabled = true
  }
  node_to_node_encryption {
    enabled = true
  }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }
  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = var.transfers_indexer_username
      master_user_password = var.transfers_indexer_password
    }
  }
}

resource "aws_opensearch_domain_policy" "main_transfers" {
  domain_name = aws_opensearch_domain.domain_transfers.domain_name
  access_policies = <<POLICIES
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": ["es:*"],
            "Principal": {
                "AWS" : ["*"]
            },
            "Effect": "Allow",
            "Resource": "${aws_opensearch_domain.domain_transfers.arn}/*"
        }
    ]
}
POLICIES
}

resource "aws_lambda_function" "function" {
  function_name    = "${var.package_name}-${var.environment}"
  filename         = data.archive_file.zip.output_path
  source_code_hash = data.archive_file.zip.output_base64sha256
  role             = aws_iam_role.role.arn
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  timeout          = 30
  memory_size      = 256
  environment {
    variables = {
      NODE_NO_WARNINGS           = 1
      ENVIRONMENT                = var.environment
      INDEXER_URL                = "https://${aws_opensearch_domain.domain.endpoint}"
      INDEXER_USERNAME           = var.indexer_username
      INDEXER_PASSWORD           = var.indexer_password
      TRANSFERS_INDEXER_URL      = "https://${aws_opensearch_domain.domain_transfers.endpoint}"
      TRANSFERS_INDEXER_USERNAME = var.transfers_indexer_username
      TRANSFERS_INDEXER_PASSWORD = var.transfers_indexer_password
      LOG_LEVEL                  = var.log_level
    }
  }
  kms_key_arn      = ""
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.package_name}-${var.environment}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
  }
  route_key     = "ANY /${aws_lambda_function.function.function_name}"
  target        = aws_lambda_function.function.arn
}

resource "aws_apigatewayv2_route" "route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /"
}

resource "aws_apigatewayv2_route" "route_cross-chain" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /cross-chain/{function}"
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = "${var.package_name}-${var.environment}-rule"
  schedule_expression = "cron(*/15 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "target" {
  rule      = aws_cloudwatch_event_rule.schedule.name
  target_id = aws_lambda_function.function.id
  arn       = aws_lambda_function.function.arn
}