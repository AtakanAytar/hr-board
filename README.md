# HR Board

A free, real-time task board for an HR team — who is doing what, and where it
stands.

Every card is just a task. Hiring is one kind of task alongside payroll,
onboarding, policy work and reviews; tag it `hiring` if you want to filter on it.

- **Status view** — To Do / In Progress / Blocked / Done (rename or add your own)
- **By person view** — one column per person; drag a card onto someone to reassign it
- **Live sync** — everyone on the board sees changes instantly, on any device
- **Real access control** — the database itself refuses anyone not on the people list
- **Works offline** — changes queue up and sync when the connection returns
- **CSV + JSON export** — for reporting or backups
- Search, filters (owner / priority / overdue / unassigned), activity log, dark mode, touch-friendly drag

### Assigning work does not require an account

The **People** dialog keeps two separate lists, and this distinction matters:

| | Who belongs here | Needs a Google account? |
|---|---|---|
| **Assignees** | Anyone you track work for — managers, agency contacts, people who will never touch the board | **No.** Just a name. |
| **Board access** | People who actually open the board and move cards | Yes — they sign in with Google. |

So you can run a board covering fifteen people where only you ever log in.
Assignees show up as columns in **By person** and as options in the Owner field;
the Owner field is also free text, so you can type a name that is on neither list
and it just works.

Total running cost: **$0**. Static hosting on GitHub Pages, data in Firebase's
free Spark tier (50,000 reads and 20,000 writes a day — a busy board uses a
tiny fraction of that). No credit card, and nothing expires.

---

## Try it right now

```bash
python3 -m http.server 8777
```

Open <http://localhost:8777/?demo=1>. That's **demo mode**: fully functional,
seeded with sample tasks, saved only in your own browser. Nothing is shared.

---

## Setup (about 10 minutes, once)

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** → name it (e.g. `hr-board`) → you can turn Google
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

**Before publishing, set the founder email.** Near the top of the file:

```
function isFounder() {
  return signedIn() && myEmail() == "PUT_THE_OWNER_EMAIL_HERE";
}
```

Put the intended owner's Google address there, lower case. Only that account
can bring the board into existence. Without the pin, "signed in" means any
Google account in the world and the first arrival at an unclaimed board becomes
its permanent owner — recoverable only by deleting the document by hand. Left
as the placeholder, nobody can create the board, which is the safe failure.

The rules are what actually protect the board: only addresses on its people
list can read or write it, no matter who has the link.

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
**People** and add each teammate's Google address under **Board access**. Anyone
not on that list is refused by the database with a clear message.

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

### What a card holds

Title, owner, status, priority, due date, tags, notes. Deliberately little —
add fields when you actually miss them, not in advance.

### Who can get in

| Situation | What happens |
|---|---|
| Not signed in | Refused. Verified: an anonymous REST read of the board and of the whole collection both return `PERMISSION_DENIED`. |
| Signed in, not on the list | Refused by the database on every board and card read. The app says so plainly and offers to switch account. |
| Signed in, on the list | Full access to this board. |
| Board not created yet, not the founder | Refused, with a message saying the board isn't set up rather than blaming the visitor. |

Anyone who clicks sign-in does get a row in **Authentication → Users** even when
refused. That is an identity record, not access; delete the row if you like.

To revoke someone: **People → Board access → ×**. They lose access on their next
read, which for an open tab is immediate.

### Deploying an update

```bash
./bump.sh && git commit -am "what changed" && git push
```

`bump.sh` stamps a fresh `?v=` on every asset URL. Without it a returning
visitor can run a cached older script against freshly deployed markup for as
long as the CDN cache lasts, which is how you get a blank page that fixes
itself in ten minutes and is miserable to debug. The rendering code is also
written to skip a missing element rather than throw, so a mismatch costs you
one widget instead of the whole board.

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
