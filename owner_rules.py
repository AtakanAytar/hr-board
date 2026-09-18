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

# Gmail treats these as the same mailbox; Firebase reports whichever spelling
# the account was registered with, and the rules compare exact strings.
DOT_BLIND = {"gmail.com", "googlemail.com"}


def variants(email):
    """Every spelling this mailbox can sign in as, most canonical first."""
    local, _, domain = email.partition("@")
    out = [email]
    if domain in DOT_BLIND:
        base = local.split("+", 1)[0]          # +tags are ignored by Gmail
        for form in (base, base.replace(".", "")):
            candidate = f"{form}@{domain}"
            if candidate not in out:
                out.append(candidate)
    return out
given, seen = [], set()
for raw in args:
    e = raw.strip().lower()
    if not EMAIL.match(e):
        sys.exit(f"not an email address: {raw}")
    if e not in seen:
        seen.add(e)
        given.append(e)

owner_forms = variants(given[0])
emails, seen = [], set()
for g in given:
    for v in variants(g):
        if v not in seen:
            seen.add(v)
            emails.append(v)
rules = (root / "firestore.rules").read_text()
if "PUT_THE_OWNER_EMAIL_HERE" not in rules or '"PUT_TEAM_EMAILS_HERE"' not in rules:
    sys.exit("firestore.rules is missing its placeholders — did it get overwritten?")

fmt = lambda xs: ",\n        ".join(f'"{e}"' for e in xs)
out = (rules
       .replace('"PUT_THE_OWNER_EMAIL_HERE"', fmt(owner_forms))
       .replace('"PUT_TEAM_EMAILS_HERE"', fmt(emails)))

# never ship a file that silently granted nothing, or kept a placeholder
assert "PUT_" not in out, "a placeholder survived substitution"
for e in emails:
    assert f'"{e}"' in out, f"{e} did not make it into the output"

(root / "firestore.rules.local").write_text(out)
print("wrote firestore.rules.local")
for g in given:
    role = "owner " if g == given[0] else "member"
    extra = [v for v in variants(g) if v != g]
    note = f"   (+ {', '.join(extra)})" if extra else ""
    print(f"  {role}: {g}{note}")
print(f"  {len(emails)} spellings allowed in total")
print("paste it into: Firestore Database -> Rules -> Publish")
