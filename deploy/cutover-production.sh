#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this script as root on the production server." >&2
  exit 1
fi

deploy_user="deploy"
deploy_root="/opt/listentogether"
legacy_root="/www/wwwroot/podcast-together"
legacy_data="$legacy_root/server/data"
site_conf="/www/server/panel/vhost/nginx/podcast.still-fantasy.com.conf"
site_origin="https://podcast.still-fantasy.com"
old_pm2_app="podcast-together-api"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -x /www/server/nginx/sbin/nginx ]]; then
  nginx_bin="/www/server/nginx/sbin/nginx"
elif command -v nginx >/dev/null 2>&1; then
  nginx_bin="$(command -v nginx)"
else
  echo "Nginx executable was not found." >&2
  exit 2
fi

for command_name in curl docker pg_dump pm2 python3 runuser; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 2
  fi
done

for required_path in \
  "$site_conf" \
  "$deploy_root/compose.yml" \
  "$deploy_root/compose.env" \
  "$deploy_root/server.env"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Required file is missing: $required_path" >&2
    exit 3
  fi
done

if ! curl --fail --silent --show-error http://127.0.0.1:18080/healthz | grep -qx 'ok'; then
  echo "The new web container is not healthy on 127.0.0.1:18080." >&2
  exit 4
fi

container_health="$(docker inspect listentogether-api-1 listentogether-web-1 \
  --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')"
if grep -qv '^healthy$' <<< "$container_health"; then
  echo "One or more new containers are not healthy." >&2
  exit 4
fi

install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/backups"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/data/uploads"

nginx_backup="$deploy_root/backups/nginx-podcast.still-fantasy.com-$timestamp.conf"
database_backup="$deploy_root/backups/postgres-allcanlisten-cutover-$timestamp.dump"
cp -a "$site_conf" "$nginx_backup"
chown "$deploy_user:$deploy_user" "$nginx_backup"
chmod 600 "$nginx_backup"

(
  cd /tmp
  runuser -u postgres -- pg_dump --format=custom allcanlisten
) > "$database_backup"
chown "$deploy_user:$deploy_user" "$database_backup"
chmod 600 "$database_backup"

sync_runtime_data() {
  if [[ -d "$legacy_data/uploads" ]]; then
    cp -a "$legacy_data/uploads/." "$deploy_root/data/uploads/"
  fi
  if [[ -f "$legacy_data/qq-music-cookie.txt" ]]; then
    install -m 600 -o "$deploy_user" -g "$deploy_user" \
      "$legacy_data/qq-music-cookie.txt" "$deploy_root/data/qq-music-cookie.txt"
  fi
  chown -R "$deploy_user:$deploy_user" "$deploy_root/data"
  find "$deploy_root/data" -type d -exec chmod 750 {} +
}

# Reduce the interval in which an upload could arrive between the copy and proxy switch.
sync_runtime_data

temporary_conf="$(mktemp "$(dirname "$site_conf")/.podcast.still-fantasy.com.conf.XXXXXX")"
cleanup() {
  rm -f "$temporary_conf"
}
trap cleanup EXIT
cp --preserve=mode,ownership "$site_conf" "$temporary_conf"

python3 - "$temporary_conf" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as source:
    config = source.read()

replacements = {
    "proxy_pass http://127.0.0.1:3001/api/;": "proxy_pass http://127.0.0.1:18080/api/;",
    "proxy_pass http://127.0.0.1:3001/ws;": "proxy_pass http://127.0.0.1:18080/ws;",
    "proxy_pass http://127.0.0.1:3001/uploads/;": "proxy_pass http://127.0.0.1:18080/uploads/;",
}
for old, new in replacements.items():
    if config.count(old) != 1:
        raise SystemExit("Expected exactly one Nginx directive: " + old)
    config = config.replace(old, new)

for old, new in (
    ("location /api/", "location ^~ /api/"),
    ("location /uploads/", "location ^~ /uploads/"),
):
    if config.count(old) != 1:
        raise SystemExit("Expected exactly one Nginx location: " + old)
    config = config.replace(old, new)

vue_pattern = re.compile(
    r"location\s+/\s*\{\s*try_files\s+\$uri\s+\$uri/\s+/index\.html;\s*\}",
    re.MULTILINE,
)
proxy_location = """location ^~ /
{
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}"""
config, count = vue_pattern.subn(proxy_location, config)
if count != 1:
    raise SystemExit("Expected exactly one Vue history location block")

with open(path, "w", encoding="utf-8") as output:
    output.write(config)
PY

mv -f "$temporary_conf" "$site_conf"
temporary_conf=""

restore_nginx() {
  cp -a "$nginx_backup" "$site_conf"
  chown root:root "$site_conf"
  "$nginx_bin" -t
  "$nginx_bin" -s reload
}

if ! "$nginx_bin" -t; then
  echo "Nginx validation failed; restoring the original configuration." >&2
  restore_nginx
  exit 5
fi

"$nginx_bin" -s reload

public_health=""
for _attempt in {1..20}; do
  if public_health="$(curl --fail --silent --show-error --max-time 5 \
      --resolve podcast.still-fantasy.com:443:127.0.0.1 \
      "$site_origin/healthz" 2>/dev/null)" && [[ "$public_health" == "ok" ]]; then
    break
  fi
  public_health=""
  sleep 1
done

if [[ "$public_health" != "ok" ]]; then
  echo "Public health check failed; restoring the original Nginx configuration." >&2
  restore_nginx
  exit 6
fi

pm2 stop "$old_pm2_app"
sync_runtime_data

echo "Production cutover completed."
echo "Nginx backup: $nginx_backup"
echo "Database backup: $database_backup"
echo "Public health: $site_origin/healthz -> ok"
echo "The old PM2 app is stopped but retained for rollback."
