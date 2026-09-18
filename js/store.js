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
import { firebaseConfig, isConfigured, BOARD_ID, DEFAULT_COLUMNS } from "./config.js?v=202609180941";
import { uid, todayISO } from "./util.js?v=202609180941";

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
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.archive = parsed.archive || {};   // boards saved before archiving existed
        return parsed;
      }
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
    const b = emptyBoard("siz@ornek.com");
    b.members = [
      { email: "siz@ornek.com", name: "Sen", role: "owner" },
      { email: "deniz@ornek.com", name: "Deniz Arslan", role: "member" },
    ];
    b.allowedEmails = b.members.map((m) => m.email);
    /* Mert ve Ayşe hiç giriş yapmaz — yalnızca iş atanan kişilerdir. */
    b.assignees = ["Sen", "Deniz Arslan", "Mert Çelik", "Ayşe Demir"];
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    /* İşe alım burada yalnızca görev türlerinden biri; diğer işlerin yanında durur. */
    const rows = [
      ["Kıdemli Backend Geliştirici alımını tamamla", "Deniz Arslan", "doing",   "high",   day(9),  ["işe alım"]],
      ["Eylül bordrosunu çalıştır",                   "Sen",          "doing",   "urgent", day(2),  ["bordro"]],
      ["1 Ekim'de başlayan 3 kişinin oryantasyonu",   "Ayşe Demir",   "todo",    "normal", day(13), ["oryantasyon"]],
      ["Uzaktan çalışma politikasını güncelle",       "Mert Çelik",   "todo",    "low",    "",      ["politika"]],
      ["3. çeyrek performans değerlendirmeleri",      "Deniz Arslan", "blocked", "normal", day(-3), ["değerlendirme", "yönetim onayı bekliyor"]],
      ["Sağlık sigortası sözleşmesini yenile",        "Mert Çelik",   "done",    "normal", day(-8), ["yan haklar"]],
    ];
    const cards = {};
    rows.forEach((r, i) => {
      const c = makeCard({
        title: r[0], owner: r[1], columnId: r[2], priority: r[3],
        dueDate: r[4], tags: r[5], order: (i + 1) * 1000,
        notes: "", updatedBy: "Demo verisi",
      });
      cards[c.id] = c;
    });
    return {
      board: b,
      cards,
      archive: {},
      activity: [{ id: uid("a"), text: "Demo pano oluşturuldu", who: "Sistem", ts: Date.now() }],
    };
  }

  return {
    mode: "demo",
    user: { uid: "demo", name: "Demo kullanıcı", email: "siz@ornek.com", photo: "" },
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

    async archiveCard(card) {
      state.archive[card.id] = { ...state.cards[card.id], ...card, archivedAt: Date.now(), archivedBy: "Sen" };
      delete state.cards[card.id];
      persist();
    },
    async unarchiveCard(card) {
      const { archivedAt, archivedBy, ...rest } = state.archive[card.id] || card;
      state.cards[card.id] = { ...rest, updatedAt: Date.now() };
      delete state.archive[card.id];
      persist();
      void archivedAt; void archivedBy;
    },
    async deleteArchived(id) { delete state.archive[id]; persist(); },

    async loadArchive({ cursor = 0, pageSize = 25 } = {}) {
      const all = Object.values(state.archive)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
      const items = all.slice(cursor, cursor + pageSize);
      const next = cursor + items.length;
      return { items, cursor: next, done: next >= all.length };
    },
    async logActivity(text) {
      state.activity.unshift({ id: uid("a"), text, who: "Sen", ts: Date.now() });
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
    addDoc, getDocs, query, orderBy, limit, startAfter, writeBatch,
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
  const archRef = collection(db, "boards", BOARD_ID, "archive");

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

      /* Bootstrap. Only the founder named in firestore.rules can create the
         board; everyone else must be added to it afterwards. The two failure
         modes read very differently to a person, so keep them apart. */
      try {
        const snap = await getDoc(boardRef);
        if (!snap.exists()) {
          try {
            await setDoc(boardRef, {
              ...emptyBoard(api.user.email),
              assignees: api.user.name ? [api.user.name] : [],
              members: [{ email: api.user.email, name: api.user.name, role: "owner" }],
            });
          } catch (e) {
            return api._err(e?.code === "permission-denied"
              ? { code: "not-founder", message:
                  `Bu pano henüz kurulmamış ve ${api.user.email} panoyu kurma yetkisi olan ` +
                  "hesap değil. Önce pano sahibinin bir kez giriş yapması gerekiyor." }
              : translate(e));
          }
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

    /* Archiving moves the document out of the live collection rather than
       flagging it, so the board's read cost stays flat as the years pass.
       Batched, so a card can never exist in both places or neither. */
    async archiveCard(card) {
      const { id, ...rest } = card;
      const batch = writeBatch(db);
      batch.set(doc(archRef, id), {
        ...rest,
        archivedAt: Date.now(),
        archivedBy: api.user?.name || "",
      });
      batch.delete(doc(cardsRef, id));
      await batch.commit().catch((e) => api._err(translate(e)));
    },

    async unarchiveCard(card) {
      const { id, archivedAt, archivedBy, ...rest } = card;
      const batch = writeBatch(db);
      batch.set(doc(cardsRef, id), { ...rest, updatedAt: Date.now() });
      batch.delete(doc(archRef, id));
      await batch.commit().catch((e) => api._err(translate(e)));
      void archivedAt; void archivedBy;
    },

    async deleteArchived(id) { await deleteDoc(doc(archRef, id)).catch((e) => api._err(translate(e))); },

    /* Paged, and only ever read when someone opens the archive. */
    async loadArchive({ cursor = null, pageSize = 25 } = {}) {
      const base = [orderBy("archivedAt", "desc"), limit(pageSize)];
      const q = cursor
        ? query(archRef, orderBy("archivedAt", "desc"), startAfter(cursor), limit(pageSize))
        : query(archRef, ...base);
      try {
        const snap = await getDocs(q);
        return {
          items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          cursor: snap.docs[snap.docs.length - 1] || null,
          done: snap.size < pageSize,
        };
      } catch (e) {
        api._err(translate(e));
        return { items: [], cursor: null, done: true };
      }
    },

    async logActivity(text) {
      await addDoc(actRef, { text, who: api.user?.name || "biri", ts: Date.now() }).catch(() => {});
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
        "Bu Google hesabı panonun kişi listesinde değil. " +
        "Pano sahibinden e-posta adresinizi “Kişiler → Pano erişimi” altına " +
        "eklemesini isteyin, sonra tekrar giriş yapın.",
    };
  }
  if (code === "unavailable") {
    return { code, message: "Veritabanına ulaşılamıyor — bağlantınız yok gibi görünüyor. Değişiklikler bağlandığınızda eşitlenecek." };
  }
  if (code === "failed-precondition") {
    return { code, message: "Bu Firebase projesinde Firestore henüz açık değil. Firebase konsolundan veritabanını oluşturup sayfayı yenileyin." };
  }
  return { code, message: e?.message || "Veritabanıyla iletişimde bir sorun oluştu." };
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
