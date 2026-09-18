#!/usr/bin/env bash
# Stamp every asset URL with a new version so browsers cannot mix an old
# cached script with new markup. Run this before each deploy:
#     ./bump.sh && git commit -am "…" && git push
set -euo pipefail
cd "$(dirname "$0")"

V="${1:-$(date +%Y%m%d%H%M)}"

# index.html -> styles.css, js/app.js      js/*.js -> ./sibling.js
perl -pi -e "s{(href=\"styles\.css)(\?v=[^\"]*)?\"}{\$1?v=$V\"}g"              index.html
perl -pi -e "s{(src=\"js/app\.js)(\?v=[^\"]*)?\"}{\$1?v=$V\"}g"                index.html
perl -pi -e "s{(from \"\./(?:store|config|util)\.js)(\?v=[^\"]*)?\"}{\$1?v=$V\"}g" js/*.js
perl -pi -e "s{(import\(\`\\\$\{SDK\}/firebase-[a-z]+\.js)(\?v=[^\`]*)?\`\)}{\$1\`)}g" js/store.js

python3 ./preflight.py
echo "stamped v=$V"
grep -n "?v=$V" index.html js/*.js | sed 's/^/  /'
