#!/usr/bin/env bash
# Produce a paste-ready rules file with the real owner address filled in.
# Output is gitignored, so a public repo never carries a private email.
#     ./owner-rules.sh her@company.com
set -euo pipefail
cd "$(dirname "$0")"
[ $# -eq 1 ] || { echo "usage: ./owner-rules.sh owner@example.com" >&2; exit 1; }
EMAIL="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
sed "s/PUT_THE_OWNER_EMAIL_HERE/$EMAIL/" firestore.rules > firestore.rules.local
echo "wrote firestore.rules.local for $EMAIL"
echo "paste it into: Firestore Database -> Rules -> Publish"
