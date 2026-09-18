#!/usr/bin/env bash
# Produce a paste-ready rules file with the real addresses filled in.
# Output is gitignored, so a public repo never carries private emails.
#
#     ./owner-rules.sh owner@example.com [member@example.com ...]
#
# The first address owns the board: only it can create the board, change who
# has access, and add or delete columns. Every listed address, owner included,
# may sign in and work on the board.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 owner_rules.py "$@"
