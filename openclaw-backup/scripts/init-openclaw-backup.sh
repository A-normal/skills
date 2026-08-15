#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="/root/.openclaw/workspace/state/openclaw-backup"
GITHUB_DIR="/library/github"
TOKEN_FILE="$GITHUB_DIR/token"
REPO_FILE="$GITHUB_DIR/repo"
RECIPIENT_FILE="$STATE_DIR/age-recipient"
CONFIG_FILE="$STATE_DIR/config.env"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_TEMPLATE="$SCRIPT_DIR/../config/backup.env.example"

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "初始化必须由 root 执行" >&2
  exit 2
}

[[ -t 0 ]] || {
  echo "初始化需要交互式终端；定时任务不得自动初始化" >&2
  exit 3
}

install -d -m 700 -o root -g root "$GITHUB_DIR" "$STATE_DIR"

if [[ ! -f "$REPO_FILE" ]]; then
  read -r -p "GitHub 仓库（owner/repository）: " github_repo
  [[ "$github_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
    echo "仓库格式无效" >&2
    exit 4
  }
  printf '%s\n' "$github_repo" | install -m 600 -o root -g root /dev/stdin "$REPO_FILE"
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  read -r -s -p "GitHub Token: " github_token
  printf '\n'
  [[ -n "$github_token" ]] || {
    echo "Token 不能为空" >&2
    exit 4
  }
  printf '%s\n' "$github_token" | install -m 600 -o root -g root /dev/stdin "$TOKEN_FILE"
  unset github_token
fi

if [[ ! -f "$RECIPIENT_FILE" ]]; then
  read -r -p "age 公开 recipient: " age_recipient
  [[ "$age_recipient" =~ ^age1[0-9a-z]+$ ]] || {
    echo "age recipient 格式无效" >&2
    exit 4
  }
  printf '%s\n' "$age_recipient" | install -m 600 -o root -g root /dev/stdin "$RECIPIENT_FILE"
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  install -m 600 -o root -g root "$CONFIG_TEMPLATE" "$CONFIG_FILE"
fi

chown root:root "$TOKEN_FILE" "$REPO_FILE" "$RECIPIENT_FILE" "$CONFIG_FILE"
chmod 600 "$TOKEN_FILE" "$REPO_FILE" "$RECIPIENT_FILE" "$CONFIG_FILE"

echo "初始化完成。请立即执行一次备份和解密校验。"
