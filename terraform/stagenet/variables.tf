variable "aws_region" {
  description = "AWS region"
  default     = "us-east-2"
}

variable "project_name" {
  description = "Project name"
  default     = "axelarscan"
}

variable "environment" {
  description = "Environment"
  default     = "stagenet"
}

variable "general_indexer_url" {
  description = "General indexer url"
  default     = ""
}

variable "general_indexer_username" {
  description = "General indexer username"
  default     = ""
}

variable "general_indexer_password" {
  description = "General indexer password"
  default     = ""
  sensitive   = true
}

variable "transfers_indexer_url" {
  description = "Transfers indexer url"
  default     = ""
}

variable "transfers_indexer_username" {
  description = "Transfers indexer username"
  default     = ""
}

variable "transfers_indexer_password" {
  description = "Transfers indexer password"
  sensitive   = true
  default     = ""
}

variable "log_level" {
  description = "Log level"
  default     = "debug"
}