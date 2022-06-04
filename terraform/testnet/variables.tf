variable "aws_region" {
  description = "AWS region"
  default     = "us-east-2"
}

variable "aws_profile" {
  description = "AWS profile"
  default     = "axelarscan.io"
}

variable "package_name" {
  description = "Package name"
  default     = "axelarscan-api"
}

variable "environment" {
  description = "Environment"
  default     = "testnet"
}

variable "indexer_username" {
  description = "Indexer username"
  default     = "axelarscan"
}

variable "indexer_password" {
  description = "Indexer password"
  default     = "0xAxelarsc@n"
}

variable "transfers_indexer_username" {
  description = "Transfers indexer username"
  default     = "axelarscan"
}

variable "transfers_indexer_password" {
  description = "Transfers indexer password"
  default     = "0xAxelarsc@n"
}

variable "log_level" {
  description = "Log level"
  default     = "debug"
}