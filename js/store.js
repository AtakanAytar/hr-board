/* ------------------------------------------------------------------
   Data layer. Two interchangeable back ends behind one interface:

     cloud : Firebase Auth (Google) + Firestore, live-synced across
             everyone on the board.
     demo  : localStorage in this browser only, used automatically
             while js/config.js still holds placeholder keys.

   Interface
     store.mode                'cloud' | 'demo'
     store.user                signed-in user or null
     store.onAuth(cb)          cb(user|null)
     store.signIn() / signOut()
     store.open(cb)            cb({board, cards}) on every change
     store.onError(cb)         cb({code, message})
     store.saveBoard(patch)
     store.upsertCard(card)    card.id required
     store.deleteCard(id)
     store.logActivity(text)
     store.onActivity(cb)
------------------------------------------------------------------- */
import { firebaseConfig, isConfigured, BOARD_ID, DEFAULT_COLUMNS } from "./config.js?v=202609180310";
import { uid, todayISO } from "./util.js?v=202609180310";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

const emptyBoard = (ownerEmail = "") => ({
  name: "HR Board",
  columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),

  /* Two separate lists, on purpose:
       assignees     names you can put work on — no account, no sign-in
       allowedEmails Google accounts allowed to open and edit the board  */
  assignees: [],
  ownerEmail,
  allowedEmails: ownerEmail ? [ownerEmail] : [],
  members: ownerEmail ? [{ email: ownerEmail, name: "", role: "owner" }] : [],
  createdAt: Date.now(),
});

export function makeCard(patch = {}) {
  return {
    id: uid("card"),
    title: "",
    owner: "",
    columnId: DEFAULT_COLUMNS[0].id,
    priority: "normal",
    dueDate: "",
    tags: [],
    notes: "",
    order: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: "",
    ...patch,
  };
}

/* ============================================================
   DEMO back end — localStorage
   ============================================================ */
function demoStore() {
  const KEY = `kanban:${BOARD_ID}`;
  let state = load();
  let onData = () => {};
  let onAct = () => {};

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupt or blocked storage — fall through to seed */ }
    return seed();
  }
  function persist() {
    state.board.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
    emit();
  }
  function emit() {
    onData({ board: state.board, cards: Object.values(state.cards) });
    onAct(state.activity.slice(0, 60));
  }

  function seed() {
    const b = emptyBoard("you@example.com");
    b.members = [
      { email: "you@example.com", name: "You", role: "owner" },
      { email: "deniz@example.com", name: "Deniz Arslan", role: "member" },
    ];
    b.allowedEmails = b.members.map((m) => m.email);
    /* Mert and Ayşe never sign in — they are just people work sits on. */
    b.assignees = ["You", "Deniz Arslan", "Mert Çelik", "Ayşe Demir"];
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    /* Hiring is just one kind of task here, alongside the rest of the work. */
    const rows = [
      ["Close Senior Backend Engineer role", "Deniz Arslan", "doing",   "high",   day(9),  ["hiring"]],
      ["Run September payroll",              "You",          "doing",   "urgent", day(2),  ["payroll"]],
      ["Onboard 3 new starters (Oct 1)",     "Ayşe Demir",   "todo",    "normal", day(13), ["onboarding"]],
      ["Update remote work policy",          "Mert Çelik",   "todo",    "low",    "",      ["policy"]],
      ["Q3 performance review cycle",        "Deniz Arslan", "blocked", "normal", day(-3), ["reviews", "waiting on leadership"]],
      ["Renew health insurance contract",    "Mert Çelik",   "done",    "normal", day(-8), ["benefits"]],
    ];
    const cards = {};
    rows.forEach((r, i) => {
      const c = makeCard({
        title: r[0], owner: r[1], columnId: r[2], priority: r[3],
        dueDate: r[4], tags: r[5], order: (i + 1) * 1000,
        notes: "", updatedBy: "Demo data",
      });
      cards[c.id] = c;
    });
    return {
      board: b,
      cards,
      activity: [{ id: uid("a"), text: "Demo board created", who: "System", ts: Date.now() }],
    };
  }

  return {
    mode: "demo",
    user: { uid: "demo", name: "Demo user", email: "you@example.com", photo: "" },
    onAuth(cb) { setTimeout(() => cb(this.user), 0); },
    async signIn() {},
    async signOut() { location.reload(); },
    onError() {},
    open(cb) { onData = cb; emit(); },
    onActivity(cb) { onAct = cb; },
    async saveBoard(patch) { Object.assign(state.board, patch); persist(); },
    async upsertCard(card) {
      state.cards[card.id] = { ...state.cards[card.id], ...card, updatedAt: Date.now() };
      persist();
    },
    async deleteCard(id) { delete state.cards[id]; persist(); },
    async logActivity(text) {
      state.activity.unshift({ id: uid("a"), text, who: "You", ts: Date.now() });
      state.activity = state.activity.slice(0, 200);
      persist();
    },
    async resetDemo() { state = seed(); persist(); },
  };
}

/* ============================================================
   CLOUD back end — Firebase
   ============================================================ */
async function cloudStore() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut: fbSignOut,
    onAuthStateChanged, setPersistence, browserLocalPersistence,
  } = authMod;
  const {
    initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
    addDoc, query, orderBy, limit,
  } = fsMod;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    db = getFirestore(app); // e.g. private-mode browsers without IndexedDB
  }

  const boardRef = doc(db, "boards", BOARD_ID);
  const cardsRef = collection(db, "boards", BOARD_ID, "cards");
  const actRef = collection(db, "boards", BOARD_ID, "activity");

  const api = {
    mode: "cloud",
    user: null,
    _err: () => {},
    _data: () => {},
    _act: () => {},
    _unsubs: [],

    onAuth(cb) {
      onAuthStateChanged(auth, (u) => {
        api.user = u
          ? { uid: u.uid, name: u.displayName || u.email, email: (u.email || "").toLowerCase(), photo: u.photoURL || "" }
          : null;
        cb(api.user);
      });
    },

    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    },

    async signOut() {
      api._unsubs.forEach((u) => u());
      api._unsubs = [];
      await fbSignOut(auth);
    },

    onError(cb) { api._err = cb; },
    onActivity(cb) { api._act = cb; },

    async open(cb) {
      api._data = cb;

      /* Bootstrap: the very first person to sign in creates the board
         and becomes its owner. Everyone else must be invited. */
      try {
        const snap = await getDoc(boardRef);
        if (!snap.exists()) {
          await setDoc(boardRef, {
            ...emptyBoard(api.user.email),
            assignees: api.user.name ? [api.user.name] : [],
            members: [{ email: api.user.email, name: api.user.name, role: "owner" }],
          });
        }
      } catch (e) {
        return api._err(translate(e));
      }

      api._unsubs.push(
        onSnapshot(boardRef, (s) => {
          if (s.exists()) api._data({ board: s.data() });
        }, (e) => api._err(translate(e))),

        onSnapshot(cardsRef, (s) => {
          api._data({ cards: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
        }, (e) => api._err(translate(e))),

        onSnapshot(query(actRef, orderBy("ts", "desc"), limit(60)), (s) => {
          api._act(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        }, () => {}),
      );
    },

    async saveBoard(patch) { await updateDoc(boardRef, patch).catch((e) => api._err(translate(e))); },

    async upsertCard(card) {
      const { id, ...rest } = card;
      rest.updatedAt = Date.now();
      rest.updatedBy = api.user?.name || "";
      await setDoc(doc(cardsRef, id), rest, { merge: true }).catch((e) => api._err(translate(e)));
    },

    async deleteCard(id) { await deleteDoc(doc(cardsRef, id)).catch((e) => api._err(translate(e))); },

    async logActivity(text) {
      await addDoc(actRef, { text, who: api.user?.name || "someone", ts: Date.now() }).catch(() => {});
    },
  };

  return api;
}

function translate(e) {
  const code = e?.code || "";
  if (code === "permission-denied") {
    return {
      code,
      message:
        "This Google account isn't on the board's people list yet. " +
        "Ask the board owner to add your email under “People & access”, then sign in again.",
    };
  }
  if (code === "unavailable") {
    return { code, message: "Can't reach the database — you appear to be offline. Changes will sync when you reconnect." };
  }
  if (code === "failed-precondition") {
    return { code, message: "Firestore isn't enabled on this Firebase project yet. Create the database in the Firebase console, then reload." };
  }
  return { code, message: e?.message || "Something went wrong talking to the database." };
}

export async function createStore() {
  if (!isConfigured) return demoStore();
  try {
    return await cloudStore();
  } catch (e) {
    console.error("Firebase failed to load, falling back to demo mode:", e);
    const s = demoStore();
    s.loadError = e?.message || String(e);
    return s;
  }
}

export { emptyBoard, todayISO };
