# One EC2 instance runs the whole stack with Docker Compose:
#   Caddy (HTTPS + WebSocket proxy) -> app (Node) -> Postgres + Redis
# Secrets live in SSM Parameter Store, there is no SSH (shell access goes
# through SSM Session Manager), and a budget alert guards against surprise bills.

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_vpc" "default" {
  default = true
}

locals {
  # Free HTTPS-capable hostname that resolves to the IP, e.g. 3-91-20-7.sslip.io
  domain     = var.domain != "" ? var.domain : "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
  param_path = "/${var.name}"
}

# --- Secrets ---------------------------------------------------------------

resource "random_password" "postgres" {
  length  = 32
  special = false # used inside a connection URL
}

resource "random_password" "github_webhook" {
  length  = 40
  special = false
}

resource "random_password" "sentry_webhook" {
  length  = 40
  special = false
}

resource "random_password" "ingest_token" {
  length  = 40
  special = false
}

locals {
  secrets = {
    postgres_password     = random_password.postgres.result
    github_webhook_secret = random_password.github_webhook.result
    sentry_webhook_secret = random_password.sentry_webhook.result
    ingest_token          = random_password.ingest_token.result
    # SSM can't store empty strings, so "unset" means "no AI key".
    ai_api_key = var.ai_api_key != "" ? var.ai_api_key : "unset"
  }
}

resource "aws_ssm_parameter" "secret" {
  for_each = local.secrets
  name     = "${local.param_path}/${each.key}"
  type     = "SecureString"
  value    = each.value
}

# --- Networking --------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${var.name}-web"
  description = "HTTP/HTTPS in, everything out. No SSH: use SSM Session Manager."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP (redirects to HTTPS, and ACME challenges)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

# Allocated before the instance so its address can be baked into the hostname.
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = var.name }
}

# --- Instance role -----------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Lets SSM run deploy commands and open shell sessions (replaces SSH).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [for p in aws_ssm_parameter.secret : p.arn]
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.name}-instance"
  role = aws_iam_role.instance.name
}

# --- Server ------------------------------------------------------------------

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  vpc_security_group_ids = [aws_security_group.app.id]

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url   = var.repo_url
    branch     = var.branch
    domain     = local.domain
    region     = var.region
    param_path = local.param_path
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  tags = { Name = var.name }

  lifecycle {
    # The database lives on this disk: never replace the server just because
    # a newer AMI exists or the bootstrap script changed. Deploys go through SSM.
    ignore_changes = [ami, user_data]
  }

  depends_on = [aws_ssm_parameter.secret]
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# --- Cost guardrail ----------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
