#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

deploy_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$deploy_root/compose.yml"
compose_env="$deploy_root/compose.env"
server_env="$deploy_root/server.env"
image_tag="${1:-}"

if [[ ! "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "Expected an immutable image tag in the form sha-<40 lowercase hex characters>." >&2
  exit 2
fi

for required_file in "$compose_file" "$compose_env" "$server_env"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required deployment file: $required_file" >&2
    exit 3
  fi
done

exec 9>"$deploy_root/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 4
fi

previous_tag="$(sed -n 's/^IMAGE_TAG=//p' "$compose_env" | tail -n 1)"
if [[ -z "$previous_tag" ]]; then
  echo "compose.env must contain IMAGE_TAG." >&2
  exit 5
fi

write_image_tag() {
  local next_tag="$1"
  local temporary_file
  temporary_file="$(mktemp "$deploy_root/.compose.env.XXXXXX")"
  sed "s/^IMAGE_TAG=.*/IMAGE_TAG=$next_tag/" "$compose_env" > "$temporary_file"
  chmod 600 "$temporary_file"
  mv -f "$temporary_file" "$compose_env"
}

compose() {
  docker compose --project-directory "$deploy_root" --env-file "$compose_env" -f "$compose_file" "$@"
}

echo "Validating deployment configuration for $image_tag..."
IMAGE_TAG="$image_tag" compose config --quiet

echo "Pulling $image_tag..."
IMAGE_TAG="$image_tag" compose pull

write_image_tag "$image_tag"

echo "Starting $image_tag..."
if compose up -d --remove-orphans --wait --wait-timeout 180; then
  compose ps
  echo "Deployment completed: $image_tag"
  exit 0
fi

echo "Deployment failed; restoring $previous_tag..." >&2
write_image_tag "$previous_tag"
compose pull
compose up -d --remove-orphans --wait --wait-timeout 180
compose ps
echo "Rollback completed: $previous_tag" >&2
exit 1
