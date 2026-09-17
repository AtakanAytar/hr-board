# Hiring Board

A free, real-time kanban board for tracking open roles and who owns each one.

Built for an HR lead who needs to see, at a glance, which jobs are moving,
which are stuck, and whose plate each one is sitting on.

- **Status view** — To Do / In Progress / Blocked / Done (rename or add your own)
- **By person view** — one column per recruiter; drag a card onto someone to reassign it
- **Live sync** — everyone on the board sees changes instantly, on any device
- **Real access control** — the database itself refuses anyone not on the people list
- **Works offline** — changes queue up and sync when the connection returns
- **CSV + JSON export** — for reporting or backups
- Search, filters (owner / priority / overdue / unassigned), activity log, dark mode, touch-friendly drag

Total running cost: **$0**. Static hosting on GitHub Pages, data in Firebase's
free Spark tier (50,000 reads and 20,000 writes a day — a busy board uses a
tiny fraction of that). No credit card, and nothing expires.

---

## Try it right now

```bash
python3 -m http.server 8777
```

Open <http://localhost:8777/?demo=1>. That's **demo mode**: fully functional,
seeded with sample roles, saved only in your own browser. Nothing is shared.

---

## Setup (about 10 minutes, once)

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** → name it (e.g. `hiring-board`) → you can turn Google
   Analytics **off**.
3. Stay on the **Spark (free)** plan. Do not upgrade; you will not need to.

### 2. Turn on Google sign-in

**Build → Authentication → Get started → Google → Enable.**
Pick a support email, then **Save**.

### 3. Create the database

**Build → Firestore Database → Create database** → choose a location near your
team (`eur3` for Europe) → start in **production mode**.

### 4. Paste the security rules

Open the **Rules** tab, replace everything with the contents of
[`firestore.rules`](firestore.rules), and click **Publish**.

This is what actually protects the board: only the email addresses on the
board's people list can read or write it, no matter who has the link.

### 5. Register the web app and copy the config

**Project settings** (gear icon) **→ General → Your apps → Web (`</>`)** →
give it a nickname → **Register app**.

Firebase shows a `firebaseConfig = { ... }` block. Copy those values into
[`js/config.js`](js/config.js), replacing the `PASTE_…` placeholders.

> These values are **not secrets** — every web app ships them to the browser.
> Access is controlled by the rules in step 4, not by hiding this config.

### 6. Authorise your site's address

**Authentication → Settings → Authorized domains → Add domain.**

Add the domain you'll open the board from, e.g. `yourname.github.io`.
(`localhost` is already allowed.)

### 7. Publish

Push the folder to a GitHub repo, then **Settings → Pages → Source: deploy from
branch → `main` / root**. GitHub gives you a URL in a minute or two.

The first person to sign in becomes the **owner**. They open the account menu →
**People & access** and add each teammate's Google address. Anyone not on that
list is refused by the database with a clear message.

---

## How it fits together

```
index.html      markup + dialogs
styles.css      design tokens, light/dark, responsive
js/config.js    Firebase keys, board id, default columns   <- the only file you edit
js/util.js      dates, colours, CSV, ordering maths
js/store.js     two interchangeable back ends (Firestore | localStorage demo)
js/app.js       rendering, drag & drop, filters, dialogs
firestore.rules database-enforced access control
```

No build step, no dependencies, no framework — plain ES modules the browser
runs directly. Nothing to reinstall or re-deploy when tooling moves on.

### Card ordering

Each card holds a numeric `order`. Dropping a card between two others sets its
order to the midpoint of its neighbours, so a move rewrites **one** card rather
than renumbering the whole column — fewer writes, and no lost reorders when two
people drag at the same time.

### Adding a second board

Change `BOARD_ID` in `js/config.js` (e.g. `"grad-hiring"`) and deploy a second
copy. Both live in the same free Firebase project with separate data and
separate people lists.

---

## Running costs

| Piece | Service | Cost |
|---|---|---|
| Hosting | GitHub Pages | free, unmetered for this size |
| Database + sync | Firebase Firestore, Spark plan | free up to 50k reads / 20k writes a day |
| Sign-in | Firebase Authentication | free |
| Domain | `*.github.io` | free |

Spark-plan projects don't expire or pause. If Firestore's daily free quota were
ever exhausted the board would pause until the next day rather than bill you —
there's no card on file.
