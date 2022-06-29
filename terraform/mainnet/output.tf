output "lambda" {
  value = aws_lambda_function.function.arn
}

output "opensearch" {
  value = aws_opensearch_domain.domain.endpoint
}

output "opensearch_transfers" {
  value = aws_opensearch_domain.domain_transfers.endpoint
}

output "api_gateway" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "event_rule" {
  value = aws_cloudwatch_event_rule.schedule.arn
}

output "lambda_crawler" {
  value = aws_lambda_function.crawler.arn
}

output "event_rule_crawler" {
  value = aws_cloudwatch_event_rule.schedule_crawler.arn
}