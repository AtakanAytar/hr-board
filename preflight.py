#!/usr/bin/env python3
"""Refuse to deploy markup and scripts that disagree with each other.

The blank-board incident came from app.js reaching for an element the HTML
no longer had. That is cheap to catch here and expensive to catch in
production, where a CDN cache hides it for ten minutes.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
ids = set(re.findall(r'id="([^"]+)"', html))

problems = []

for js in sorted((root / "js").glob("*.js")):
    src = js.read_text()
    refs = set(re.findall(r'\$\("#([A-Za-z0-9_]+)"\)', src))
    refs |= set(re.findall(r'setHTML\("#([A-Za-z0-9_]+)"', src))
    for r in sorted(refs - ids):
        problems.append(f"{js.name}: selects #{r}, which index.html does not define")

# every versioned import must agree, or the browser loads two copies of a module
versions = set(re.findall(r'\?v=(\d+)', html + "".join(
    p.read_text() for p in (root / "js").glob("*.js"))))
if len(versions) > 1:
    problems.append(f"mixed asset versions {sorted(versions)} — run ./bump.sh")

# placeholder left in the security rules
rules = (root / "firestore.rules").read_text()
if "PUT_THE_OWNER_EMAIL_HERE" in rules:
    print("note: firestore.rules still has the founder placeholder — "
          "nobody can create the board until it is set", file=sys.stderr)

if problems:
    print("PREFLIGHT FAILED", file=sys.stderr)
    for p in problems:
        print("  " + p, file=sys.stderr)
    sys.exit(1)
print("preflight ok")
