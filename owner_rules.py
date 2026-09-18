#!/usr/bin/env python3
"""Fill the rules template with real addresses, into a gitignored file.

Kept in Python rather than sed/perl: an email's "@domain" interpolates as an
array in a perl replacement and silently vanishes, which produced a rules file
granting access to "fsonmez.com".
"""
import pathlib, re, sys

root = pathlib.Path(__file__).parent
args = sys.argv[1:]
if not args:
    sys.exit("usage: ./owner-rules.sh owner@example.com [member@example.com ...]")

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
emails, seen = [], set()
for raw in args:
    e = raw.strip().lower()
    if not EMAIL.match(e):
        sys.exit(f"not an email address: {raw}")
    if e not in seen:
        seen.add(e)
        emails.append(e)

owner = emails[0]
rules = (root / "firestore.rules").read_text()
if "PUT_THE_OWNER_EMAIL_HERE" not in rules or '"PUT_TEAM_EMAILS_HERE"' not in rules:
    sys.exit("firestore.rules is missing its placeholders — did it get overwritten?")

listing = ",\n        ".join(f'"{e}"' for e in emails)
out = (rules
       .replace("PUT_THE_OWNER_EMAIL_HERE", owner)
       .replace('"PUT_TEAM_EMAILS_HERE"', listing))

# never ship a file that silently granted nothing, or kept a placeholder
assert "PUT_" not in out, "a placeholder survived substitution"
for e in emails:
    assert f'"{e}"' in out, f"{e} did not make it into the output"

(root / "firestore.rules.local").write_text(out)
print("wrote firestore.rules.local")
print(f"  owner : {owner}")
for e in emails[1:]:
    print(f"  member: {e}")
print("paste it into: Firestore Database -> Rules -> Publish")
