#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "部署必须由 root 执行" >&2
  exit 2
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/root/.openclaw/workspace/state/stock-research"
CONFIG_FILE="$STATE_DIR/dashboard.env"
CONFIG_TEMPLATE="$SKILL_DIR/config/dashboard.env.example"

mkdir -p "$STATE_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  install -m 600 -o root -g root "$CONFIG_TEMPLATE" "$CONFIG_FILE"
fi

source "$CONFIG_FILE"
: "${DOMAIN:?缺少 DOMAIN}"
: "${PORT:=17110}"
: "${SSL_CERTIFICATE:=/library/ssl/domain.crt}"
: "${SSL_CERTIFICATE_KEY:=/library/ssl/domain.key}"

export NVM_DIR="/root/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
command -v nvm >/dev/null 2>&1 && nvm use --silent default >/dev/null
NODE_BIN="$(command -v node)"
[[ -x "$NODE_BIN" ]] || {
  echo "找不到 Node 可执行文件" >&2
  exit 3
}

cd "$SKILL_DIR"
npm ci --omit=dev

cat > /etc/systemd/system/stock-dashboard.service <<SYSTEMD
[Unit]
Description=Stock Research Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$SKILL_DIR
ExecStart=$NODE_BIN $SKILL_DIR/assets/dashboard/server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
SYSTEMD

cat > /etc/nginx/sites-available/stock-dashboard <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate $SSL_CERTIFICATE;
    ssl_certificate_key $SSL_CERTIFICATE_KEY;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/stock-dashboard /etc/nginx/sites-enabled/stock-dashboard
nginx -t
systemctl daemon-reload
systemctl enable --now stock-dashboard
systemctl reload nginx
systemctl is-active --quiet stock-dashboard
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null

echo "股票仪表盘部署完成：https://$DOMAIN/"
