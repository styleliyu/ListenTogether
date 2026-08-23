#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this script as root on the production server." >&2
  exit 1
fi

deploy_user="deploy"
deploy_root="/opt/listentogether"
legacy_root="${LEGACY_ROOT:-/www/wwwroot/podcast-together}"
legacy_env="$legacy_root/server/.env"
legacy_data="$legacy_root/server/data"
server_env="$deploy_root/server.env"
compose_env="$deploy_root/compose.env"

for command_name in docker python3 psql pg_dump runuser; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 2
  fi
done

if ! id "$deploy_user" >/dev/null 2>&1; then
  echo "The deploy user does not exist. Run bootstrap-server.sh first." >&2
  exit 3
fi

if [[ ! -f "$legacy_env" ]]; then
  echo "Legacy environment file not found: $legacy_env" >&2
  exit 4
fi

if [[ -e "$server_env" || -e "$compose_env" ]]; then
  echo "Refusing to overwrite existing production configuration in $deploy_root." >&2
  exit 5
fi

deploy_uid="$(id -u "$deploy_user")"
deploy_gid="$(id -g "$deploy_user")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/data"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/data/uploads"
install -d -m 750 -o "$deploy_user" -g "$deploy_user" "$deploy_root/backups"

metadata_file="$(mktemp)"
generated_env="$(mktemp)"
generated_hba=""
cleanup() {
  rm -f "$metadata_file" "$generated_env"
  if [[ -n "$generated_hba" ]]; then
    rm -f "$generated_hba"
  fi
}
trap cleanup EXIT

python3 - "$legacy_env" "$generated_env" "$metadata_file" <<'PY'
import os
import re
import sys
try:
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
except ImportError:
    from urlparse import parse_qsl, urlsplit, urlunsplit
    from urllib import urlencode

source_path, output_path, metadata_path = sys.argv[1:]
with open(source_path, "r") as source:
    lines = source.read().splitlines()

database_url = None
kept = []
managed = {
    "CORS_ORIGIN", "DATABASE_PROVIDER", "DATABASE_URL", "HOST", "PORT",
    "SQLITE_DB_PATH", "DATABASE_PATH", "UPLOAD_DIR", "QQ_MUSIC_COOKIE_FILE"
}
for raw in lines:
    stripped = raw.strip()
    if not stripped or stripped.startswith("#") or "=" not in raw:
        kept.append(raw)
        continue
    key, value = raw.split("=", 1)
    key = key.strip()
    if key == "DATABASE_URL":
        database_url = value.strip().strip('"').strip("'")
    if key not in managed:
        kept.append(raw)

if not database_url:
    raise SystemExit("DATABASE_URL is missing from the legacy environment file")

parts = urlsplit(database_url)
if parts.scheme not in ("postgres", "postgresql") or not parts.username or not parts.path.strip("/"):
    raise SystemExit("DATABASE_URL is not a supported PostgreSQL URL")

database_name = parts.path.strip("/")
database_user = parts.username
safe_name = re.compile(r"^[A-Za-z0-9_.-]+$")
if not safe_name.match(database_name) or not safe_name.match(database_user):
    raise SystemExit("Database and user names must contain only letters, numbers, dot, underscore, or hyphen")

query = parse_qsl(parts.query, keep_blank_values=True)
query = [(key, value) for key, value in query if key != "host"]
query.append(("host", "/var/run/postgresql"))
socket_url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

while kept and not kept[-1].strip():
    kept.pop()
kept.extend([
    "",
    "# Managed by deploy/prepare-postgres-server.sh",
    "CORS_ORIGIN=https://podcast.still-fantasy.com",
    "DATABASE_PROVIDER=postgres",
    "DATABASE_URL=" + socket_url,
    "UPLOAD_DIR=/app/data/uploads",
    "QQ_MUSIC_COOKIE_FILE=/app/data/qq-music-cookie.txt",
])

with open(output_path, "w") as output:
    output.write("\n".join(kept) + "\n")
with open(metadata_path, "w") as metadata:
    metadata.write(database_name + "\n" + database_user + "\n")
PY

database_name="$(sed -n '1p' "$metadata_file")"
database_user="$(sed -n '2p' "$metadata_file")"
hba_file="$(runuser -u postgres -- psql -d postgres -Atqc 'show hba_file')"

if [[ -z "$hba_file" || ! -f "$hba_file" ]]; then
  echo "Could not locate PostgreSQL pg_hba.conf." >&2
  exit 6
fi

hba_rule="local $database_name $database_user md5"
if ! grep -Fqx "$hba_rule" "$hba_file"; then
  hba_backup="$deploy_root/backups/pg_hba.conf.$timestamp"
  install -m 600 -o "$deploy_user" -g "$deploy_user" "$hba_file" "$hba_backup"
  generated_hba="$(mktemp "$(dirname "$hba_file")/.pg_hba.conf.XXXXXX")"
  {
    echo "# ListenTogether container access (Unix socket only)"
    echo "$hba_rule"
    cat "$hba_file"
  } > "$generated_hba"
  chown --reference="$hba_file" "$generated_hba"
  chmod --reference="$hba_file" "$generated_hba"
  mv -f "$generated_hba" "$hba_file"
  generated_hba=""
  if [[ "$(runuser -u postgres -- psql -d postgres -Atqc 'select pg_reload_conf()')" != "t" ]]; then
    echo "PostgreSQL rejected the configuration reload." >&2
    exit 7
  fi
fi

database_backup="$deploy_root/backups/postgres-$database_name-$timestamp.dump"
runuser -u postgres -- pg_dump --format=custom "$database_name" > "$database_backup"
chown "$deploy_user:$deploy_user" "$database_backup"
chmod 600 "$database_backup"

install -m 600 -o "$deploy_user" -g "$deploy_user" "$generated_env" "$server_env"
cat > "$compose_env" <<EOF
# This file contains only Compose deployment settings, not application secrets.
IMAGE_TAG=main
WEB_PORT=18080
WEB_IMAGE=ghcr.io/styleliyu/listentogether-web
API_IMAGE=ghcr.io/styleliyu/listentogether-api
APP_UID=$deploy_uid
APP_GID=$deploy_gid
EOF
chown "$deploy_user:$deploy_user" "$compose_env"
chmod 600 "$compose_env"

if [[ -d "$legacy_data/uploads" ]]; then
  cp -a "$legacy_data/uploads/." "$deploy_root/data/uploads/"
fi
if [[ -f "$legacy_data/qq-music-cookie.txt" ]]; then
  install -m 600 -o "$deploy_user" -g "$deploy_user" \
    "$legacy_data/qq-music-cookie.txt" "$deploy_root/data/qq-music-cookie.txt"
fi
chown -R "$deploy_user:$deploy_user" "$deploy_root/data"
find "$deploy_root/data" -type d -exec chmod 750 {} +

# The legacy file is no longer world-readable after its values have been migrated.
chmod 600 "$legacy_env"

echo "PostgreSQL access, backup, production configuration, and runtime data are prepared."
echo "Database backup: $database_backup"
echo "Web loopback port: 18080"
