#!/usr/bin/env bash
set -euo pipefail

# Package only committed source, never the working directory or personal data.
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: bash scripts/package-release.sh /path/to/minilearn.zip [commit]' >&2
  exit 2
fi
output="$1"
commit="${2:-HEAD}"
if [[ "$(basename "$output")" != minilearn.zip ]]; then
  echo 'Release archive must be named minilearn.zip.' >&2
  exit 2
fi
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ "$output" != /* ]]; then
  output="$PWD/$output"
fi

git -C "$repo_dir" archive --format=zip --prefix=minilearn/ \
  --output="$output" "$commit"
unzip -tq "$output"

# Abort publication if sensitive or machine-specific files ever become tracked.
unzip -Z1 "$output" | awk '
  !/^minilearn\// { exit 1 }
  /^minilearn\/(data|node_modules|\.git)(\/|$)/ { exit 1 }
  /\/\.env(\.|$)/ || /\.learn$/ || /\.DS_Store$/ { exit 1 }
  $0 == "minilearn/package.json" { manifest = 1 }
  $0 == "minilearn/package-lock.json" { lock = 1 }
  $0 == "minilearn/.npmrc" { npmrc = 1 }
  $0 == "minilearn/server/bootstrap.mjs" { bootstrap = 1 }
  $0 == "minilearn/web/index.html" { html = 1 }
  END { if (!(manifest && lock && npmrc && bootstrap && html)) exit 1 }
'
echo "Packaged $output"
