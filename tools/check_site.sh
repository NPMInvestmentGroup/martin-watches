#!/bin/sh
# Regenerate builds.json, serve the site locally, and run every page test. Prints only the important lines.
cd "$(dirname "$0")/.." || exit 1
node tools/gen_builds.js || exit 1
python3 -m http.server 8766 >/tmp/martin_srv.log 2>&1 & SRV=$!
sleep 2
for t in tools/tests/*.py; do
  echo "== $(basename "$t")"
  timeout 300 python3 "$t" 2>&1 | grep -E "errors|sync|teeth|failed|layers shown|did not settle|Traceback|Error" | head -20
done
kill $SRV 2>/dev/null
