/* ------------------------------------------------------------------
   Firebase connection settings.

   Until you paste real values here the app runs in DEMO MODE:
   fully usable, but data lives only in this browser and is not shared.

   Where these come from:
     Firebase console -> Project settings -> General
     -> "Your apps" -> Web app -> SDK setup and configuration -> Config
   These values are NOT secrets. A web app must ship them to the browser;
   access is controlled by firestore.rules, which only lets the emails
   listed on the board read or write it.
------------------------------------------------------------------- */
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

/* One shared board for the team. Change only if you want a second,
   separate board (e.g. "grad-hiring") living in the same project. */
export const BOARD_ID = "hiring";

export const DEFAULT_COLUMNS = [
  { id: "todo",    title: "To Do",       color: "#94a3b8" },
  { id: "doing",   title: "In Progress", color: "#3b82f6" },
  { id: "blocked", title: "Blocked",     color: "#f97316" },
  { id: "done",    title: "Done",        color: "#16a34a" },
];

const forcedDemo = new URLSearchParams(location.search).has("demo");

export const isConfigured =
  !forcedDemo && !String(firebaseConfig.apiKey).startsWith("PASTE");
