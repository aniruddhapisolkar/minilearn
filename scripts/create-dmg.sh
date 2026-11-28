#!/usr/bin/env bash
set -euo pipefail

# Image a built .app as a compressed, drag-to-Applications .dmg.
#
# Hosted macOS runners intermittently fail `hdiutil create` with
# "Resource busy" while Spotlight (mds) or XProtectBehaviourService is still
# looking at the freshly written image. Tauri's vendored create-dmg 1.2.1 retries
# the wrong exit code for that case, so its DMG step dies on the first hiccup.
# Creating the image in a single step (no attach, styling, or unmount) and
# retrying with a growing delay keeps releases publishable.
#
# Usage: bash scripts/create-dmg.sh /path/to/minilearn.app /path/to/minilearn.dmg [volume name]
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo 'Usage: bash scripts/create-dmg.sh /path/to/minilearn.app /path/to/minilearn.dmg [volume name]' >&2
  exit 2
fi

app_path="$1"
output="$2"
volume="${3:-minilearn}"
attempts=5

if [[ ! -d "$app_path" ]]; then
  echo "App bundle not found: $app_path" >&2
  exit 1
fi
if [[ "$output" != /* ]]; then
  output="$PWD/$output"
fi
mkdir -p "$(dirname -- "$output")"

stage=$(mktemp -d "${TMPDIR:-/tmp}/minilearn-dmg.XXXXXX")
cleanup() {
  rm -rf "$stage"
  hdiutil detach "/Volumes/$volume" -force >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Copy rather than reference the build output, so the image never contains
# symlinks back into the workspace.
ditto "$app_path" "$stage/$(basename -- "$app_path")"
ln -s /Applications "$stage/Applications"

for ((attempt = 1; attempt <= attempts; attempt++)); do
  rm -f "$output"
  if hdiutil create -volname "$volume" -srcfolder "$stage" -fs HFS+ \
    -format UDZO -ov "$output" && hdiutil imageinfo "$output" >/dev/null 2>&1; then
    echo "Created $output ($(du -h "$output" | cut -f1))"
    exit 0
  fi

  # A failed attempt can leave its volume mounted and keep the next one busy.
  cleanup
  pkill -f diskimages-helper >/dev/null 2>&1 || true
  rm -f "$output"

  if ((attempt == attempts)); then
    echo "Could not create $output after $attempts attempts." >&2
    hdiutil info >&2 || true
    exit 1
  fi

  delay=$((attempt * 5))
  echo "Attempt $attempt failed; retrying in ${delay}s." >&2
  sleep "$delay"
done
