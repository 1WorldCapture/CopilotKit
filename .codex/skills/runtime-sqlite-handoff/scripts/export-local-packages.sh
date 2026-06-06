#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: export-local-packages.sh /absolute/path/to/target-app" >&2
  exit 1
fi

target_app="$1"

if [[ ! -d "$target_app" ]]; then
  echo "Target app does not exist: $target_app" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
target_packages_dir="$target_app/.local-packages"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT

echo "Building forked packages with Nx..."
(cd "$repo_root" && pnpm nx run @copilotkit/runtime:build)
(cd "$repo_root" && pnpm nx run @copilotkit/sqlite-runner:build)

echo "Packing tarballs..."
(cd "$repo_root/packages/runtime" && npm pack --pack-destination "$tmp_dir" >/dev/null)
(cd "$repo_root/packages/sqlite-runner" && npm pack --pack-destination "$tmp_dir" >/dev/null)

mkdir -p "$target_packages_dir"

runtime_tgz="$(find "$tmp_dir" -maxdepth 1 -name 'copilotkit-runtime-*.tgz' | head -n 1)"
sqlite_tgz="$(find "$tmp_dir" -maxdepth 1 -name 'copilotkit-sqlite-runner-*.tgz' | head -n 1)"

if [[ -z "$runtime_tgz" || -z "$sqlite_tgz" ]]; then
  echo "Failed to find packed tarballs in $tmp_dir" >&2
  exit 1
fi

cp -f "$runtime_tgz" "$target_packages_dir/"
cp -f "$sqlite_tgz" "$target_packages_dir/"

runtime_name="$(basename "$runtime_tgz")"
sqlite_name="$(basename "$sqlite_tgz")"

cat <<EOF
Copied tarballs to:
  $target_packages_dir/$runtime_name
  $target_packages_dir/$sqlite_name

Suggested target package.json dependency entries:
  "@copilotkit/runtime": "file:.local-packages/$runtime_name"
  "@copilotkit/sqlite-runner": "file:.local-packages/$sqlite_name"
EOF
