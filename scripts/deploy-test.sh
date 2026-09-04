#!/usr/bin/env bash

set -euo pipefail

remote_host="${TEST_DEPLOY_HOST:-root@47.99.98.76}"
remote_root="${TEST_DEPLOY_ROOT:-/opt/tapcomfy/newapi}"
release_root=".release/test"
release_id="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
archive_path=".release/new-api-test-${release_id}.tar.gz"
version="$(tr -d '[:space:]' < VERSION)"

cleanup() {
  rm -rf "$release_root"
}
trap cleanup EXIT

mkdir -p "$release_root"

if [[ ! -d web/node_modules ]]; then
  (cd web && bun install --frozen-lockfile)
fi

(
  cd web
  DISABLE_ESLINT_PLUGIN=true VITE_REACT_APP_VERSION="$version" bun run build
)

GOWORK=off GOOS=linux GOARCH=amd64 CGO_ENABLED=0 GOEXPERIMENT=greenteagc \
  go build -ldflags "-s -w -X github.com/QuantumNous/new-api/common.Version=${version}" \
  -o "$release_root/new-api"

cp LICENSE NOTICE THIRD-PARTY-LICENSES.md "$release_root/"
printf '%s\n' "$version" > "$release_root/VERSION"

mkdir -p .release
COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=1 tar -C "$release_root" -czf "$archive_path" .

ssh "$remote_host" "install -d -m 0755 ${remote_root}/releases"
rsync -az "$archive_path" "${remote_host}:${remote_root}/releases/"
rsync -az deploy/compose.test-runtime.yaml "${remote_host}:${remote_root}/compose.test-runtime.yaml"

ssh "$remote_host" bash -s -- "$remote_root" "$release_id" <<'REMOTE_SCRIPT'
set -euo pipefail

deploy_root="$1"
release_id="$2"
case "$release_id" in
  *[!A-Za-z0-9._-]*|'')
    echo "Invalid release ID" >&2
    exit 1
    ;;
esac

archive_path="${deploy_root}/releases/new-api-test-${release_id}.tar.gz"
release_path="${deploy_root}/releases/${release_id}"
current_path="${deploy_root}/current"

test -f "$archive_path"
test ! -e "$release_path"
mkdir "$release_path"
tar -xzf "$archive_path" -C "$release_path"

previous_release=""
if test -L "$current_path"; then
  previous_release="$(readlink -f "$current_path")"
fi
ln -sfn "$release_path" "$current_path"

cd "$deploy_root"
if ! docker compose -f compose.yaml -f compose.test-runtime.yaml up -d --no-build --force-recreate new-api; then
  if test -n "$previous_release"; then
    ln -sfn "$previous_release" "$current_path"
    docker compose -f compose.yaml -f compose.test-runtime.yaml up -d --no-build --force-recreate new-api || true
  fi
  exit 1
fi

for _ in $(seq 1 30); do
  if docker exec tapcomfy-newapi-test wget -q -O /dev/null http://127.0.0.1:3000/api/status; then
    echo "Deployment ${release_id} is healthy"
    exit 0
  fi
  sleep 1
done

if test -n "$previous_release"; then
  ln -sfn "$previous_release" "$current_path"
  docker compose -f compose.yaml -f compose.test-runtime.yaml up -d --no-build --force-recreate new-api
fi
docker compose logs --tail=100 new-api >&2
exit 1
REMOTE_SCRIPT

rm -f "$archive_path"
