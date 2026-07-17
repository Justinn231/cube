#!/usr/bin/env bash
# One-time VPS setup (Ubuntu/Debian). Run as root on a fresh box.
set -euo pipefail

INSTALL_DIR=/opt/autonomous-business
REPO_SUBDIR_URL="${1:?usage: setup-vps.sh <git-clone-url>}"

apt-get update
apt-get install -y git curl tmux
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id -u business &>/dev/null || useradd -m -s /bin/bash business

git clone "$REPO_SUBDIR_URL" /tmp/ab-repo
mkdir -p "$INSTALL_DIR"
cp -r /tmp/ab-repo/autonomous-business/. "$INSTALL_DIR"/
rm -rf /tmp/ab-repo
cd "$INSTALL_DIR"
npm install
npm run build
[ -f .env ] || cp .env.example .env
chown -R business:business "$INSTALL_DIR"

cp deploy/autonomous-business.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable autonomous-business

echo
echo "Setup done. Next steps:"
echo "  1. Install your agent CLI for the 'business' user (e.g. npm i -g @anthropic-ai/claude-code; login once)."
echo "  2. Fill $INSTALL_DIR/.env (Telegram token/chat id, WORKER_CMD, secrets)."
echo "  3. systemctl start autonomous-business && journalctl -fu autonomous-business"
