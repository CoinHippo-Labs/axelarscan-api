output "lambda_api" {
  value = aws_lambda_function.api.arn
}

output "api_gateway" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "lambda_axelar_crawler" {
  value = aws_lambda_function.axelar_crawler.arn
}

output "event_rule_axelar_crawler" {
  value = aws_cloudwatch_event_rule.schedule_axelar_crawler.arn
}

output "lambda_evm_crawler" {
  value = aws_lambda_function.evm_crawler.arn
}

output "event_rule_evm_crawler" {
  value = aws_cloudwatch_event_rule.schedule_evm_crawler.arn
}