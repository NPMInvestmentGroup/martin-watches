#!/bin/sh
# Stamp every stylesheet link with a short hash of the file, so browsers and Cloudflare fetch
# the new styles as soon as a changed stylesheet is deployed. Run after editing any file in assets/.
cd "$(dirname "$0")/.." || exit 1
for f in assets/*.css; do
  n=$(basename "$f"); h=$(sha1sum "$f" | cut -c1-8)
  grep -rl "/assets/$n" --include=*.html . | xargs -r sed -i "s#/assets/$n\(?v=[0-9a-f]*\)\?\"#/assets/$n?v=$h\"#g"
done
