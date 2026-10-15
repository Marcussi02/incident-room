output "app_url" {
  description = "Your live app (HTTPS certificate is issued on first visit; allow ~5-10 min after apply for the first build)."
  value       = "https://${local.domain}"
}

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "shell" {
  description = "Open a shell on the server (no SSH keys needed)."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.app.id}"
}

output "github_actions_variables" {
  description = "Add these as repository variables (Settings -> Secrets and variables -> Actions -> Variables)."
  value = local.github_deploys ? {
    AWS_DEPLOY_ROLE_ARN = aws_iam_role.github_deploy[0].arn
    AWS_INSTANCE_ID     = aws_instance.app.id
    AWS_REGION          = var.region
    APP_URL             = "https://${local.domain}"
  } : null
}

output "github_webhook_secret" {
  description = "Paste into GitHub repo -> Settings -> Webhooks -> Secret."
  value       = random_password.github_webhook.result
  sensitive   = true
}
