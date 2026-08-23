#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this script as root on the target Linux server." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Engine is not installed. Install it from the official Docker repository first." >&2
  exit 2
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is not installed." >&2
  exit 3
fi

if ! docker compose up --help | grep -q -- '--wait'; then
  echo "Docker Compose is too old; install a version that supports 'compose up --wait'." >&2
  exit 3
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "The flock command is required (normally provided by util-linux)." >&2
  exit 3
fi

deploy_user="deploy"
deploy_root="/opt/listentogether"

if ! id "$deploy_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$deploy_user"
fi

if ! getent group docker >/dev/null 2>&1; then
  groupadd docker
fi
usermod -aG docker "$deploy_user"

install -d -m 700 -o "$deploy_user" -g "$deploy_user" "/home/$deploy_user/.ssh"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/data"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/backups"

echo "Paste the dedicated GitHub Actions SSH public key, then press Enter:"
IFS= read -r deploy_public_key
if [[ ! "$deploy_public_key" =~ ^ssh-ed25519[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
  echo "The supplied value is not an ssh-ed25519 public key." >&2
  exit 4
fi

authorized_keys="/home/$deploy_user/.ssh/authorized_keys"
touch "$authorized_keys"
if ! grep -Fqx "$deploy_public_key" "$authorized_keys"; then
  printf '%s\n' "$deploy_public_key" >> "$authorized_keys"
fi
chown "$deploy_user:$deploy_user" "$authorized_keys"
chmod 600 "$authorized_keys"

echo "Server bootstrap completed. Docker group membership is root-equivalent; this account is dedicated to deployment only."
echo "Open a new SSH session before testing the deploy user's Docker access."
