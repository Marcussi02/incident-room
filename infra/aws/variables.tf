variable "name" {
  description = "Prefix for every resource, and the SSM parameter path."
  type        = string
  default     = "incident-room"
}

variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 size. t4g.* (ARM/Graviton) is ~20% cheaper than t3.*; t4g.micro (1 GB RAM + 2 GB swap) is enough for a demo."
  type        = string
  default     = "t4g.micro"
}

variable "disk_gb" {
  description = "Root disk size in GB (OS, Docker images, database, swap)."
  type        = number
  default     = 12
}

variable "repo_url" {
  description = "Public Git URL the server clones and deploys."
  type        = string
  default     = "https://github.com/Marcussi02/incident-room.git"
}

variable "branch" {
  description = "Branch the server deploys."
  type        = string
  default     = "main"
}

variable "domain" {
  description = "Your own domain (point an A record at the elastic IP). Leave empty to use a free <ip>.sslip.io address."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email that receives AWS budget alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly spend that triggers a budget alert email."
  type        = number
  default     = 15
}

variable "ai_api_key" {
  description = "Optional API key for AI-drafted postmortems. Stored encrypted in SSM Parameter Store."
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_repo" {
  description = "owner/repo allowed to deploy via GitHub Actions (OIDC). Empty disables CI deploys."
  type        = string
  default     = "Marcussi02/incident-room"
}

variable "create_github_oidc_provider" {
  description = "Set to false if your AWS account already has the GitHub Actions OIDC provider."
  type        = bool
  default     = true
}
