import { createStore, makeCard } from "./store.js";
import { isConfigured, DEFAULT_COLUMNS } from "./config.js";
import {
  uid, esc, initials, colorFor, fmtDue, fmtWhen, daysUntil,
  debounce, parseTags, orderBetween, downloadFile, toCSV,
} from "./util.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ============================================================
   State
   ============================================================ */
const state = {
  board: null,
  cards: [],
  view: "status",
  search: "",
  filters: { owners: new Set(), priorities: new Set(), flags: new Set() },
  editingId: null,
};
let store = null;

/* ============================================================
   Boot
   ============================================================ */
(async function boot() {
  applyTheme(localStorage.getItem("kanban:theme") || preferredTheme());
  store = await createStore();

  if (store.mode === "demo") {
    $("#demoBadge").hidden = false;
    $("#authScreen").hidden = true;
    $("#app").hidden = false;
    paintUser(store.user);
    startBoard();
  } else {
    store.onAuth((user) => {
      if (user) {
        $("#authScreen").hidden = true;
        $("#app").hidden = false;
        paintUser(user);
        startBoard();
      } else {
        $("#app").hidden = true;
        $("#authScreen").hidden = false;
      }
    });
  }

  wireChrome();
})();

let boardStarted = false;
function startBoard() {
  if (boardStarted) return;
  boardStarted = true;
  store.onError(({ message }) => {
    $("#syncDot").classList.add("is-off");
    showBlockingError(message);
  });
  store.onActivity(renderActivity);
  store.open((patch) => {
    if (patch.board) state.board = patch.board;
    if (patch.cards) state.cards = patch.cards;
    if (!state.board) return;
    syncBoardChrome();
    render();
  });
}

function showBlockingError(message) {
  $("#app").hidden = true;
  $("#authScreen").hidden = false;
  const box = $("#authError");
  box.textContent = message;
  box.hidden = false;
}

function paintUser(user) {
  $("#popName").textContent = user.name || "Signed in";
  $("#popEmail").textContent = user.email || "";
  const img = $("#userAvatar"), ini = $("#userInitial");
  if (user.photo) { img.src = user.photo; img.hidden = false; ini.hidden = true; }
  else { ini.textContent = initials(user.name || user.email) || "?"; }
}

function syncBoardChrome() {
  const t = $("#boardTitle");
  if (document.activeElement !== t) t.textContent = state.board.name || "HR Board";
  t.contentEditable = "true";
  renderOwnerFilterChips();
  refreshDatalists();
}

/* ============================================================
   Derived data
   ============================================================ */
/** Everyone work can sit on: the roster, plus any name already on a card.
    Deliberately unrelated to who has a login — see the People dialog. */
function allOwners() {
  const set = new Set(state.board?.assignees || []);
  state.cards.forEach((c) => c.owner && set.add(c.owner));
  return [...set].sort((a, b) => a.localeCompare(b));
}

const departments = () =>
  [...new Set(state.cards.map((c) => c.department).filter(Boolean))].sort();

function visibleCards() {
  const q = state.search.trim().toLowerCase();
  const { owners, priorities, flags } = state.filters;
  return state.cards.filter((c) => {
    if (owners.size && !owners.has(c.owner || "__none__")) return false;
    if (priorities.size && !priorities.has(c.priority || "normal")) return false;
    if (flags.has("unassigned") && c.owner) return false;
    if (flags.has("overdue")) {
      const d = daysUntil(c.dueDate);
      if (d === null || d >= 0) return false;
    }
    if (q) {
      const hay = [c.title, c.owner, c.department, c.location, c.notes, (c.tags || []).join(" ")]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Column descriptors for the active view. */
function activeColumns() {
  if (state.view === "owner") {
    const names = allOwners();
    return [
      ...names.map((n) => ({ key: n, title: n, color: colorFor(n), kind: "owner" })),
      { key: "__none__", title: "Unassigned", color: "#94a3b8", kind: "owner" },
    ];
  }
  const cols = state.board?.columns?.length ? state.board.columns : DEFAULT_COLUMNS;
  return cols.map((c) => ({ key: c.id, title: c.title, color: c.color || "#94a3b8", kind: "status" }));
}

const bucketOf = (card) =>
  state.view === "owner" ? (card.owner || "__none__") : card.columnId;

/* ============================================================
   Render
   ============================================================ */
let rerenderQueued = false;
function render() {
  const board = $("#board");

  /* A live update from a teammate must not wipe out a column name
     the local user is mid-way through typing. Defer instead. */
  if (board.contains(document.activeElement) && document.activeElement.isContentEditable) {
    if (!rerenderQueued) {
      rerenderQueued = true;
      document.activeElement.addEventListener("blur", () => {
        rerenderQueued = false;
        render();
      }, { once: true });
    }
    return;
  }

  const cards = visibleCards().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cols = activeColumns();

  board.innerHTML =
    cols.map((col) => columnHTML(col, cards.filter((c) => bucketOf(c) === col.key))).join("") +
    (state.view === "status"
      ? `<button class="add-column" data-act="add-column">+ Add a column</button>`
      : "");

  $("#emptyState").hidden = !(cards.length === 0 && state.cards.length > 0);
  const n = state.filters.owners.size + state.filters.priorities.size + state.filters.flags.size;
  $("#filterCount").hidden = n === 0;
  $("#filterCount").textContent = n;
}

function columnHTML(col, cards) {
  const openings = cards.reduce((s, c) => s + (Number(c.openings) || 0), 0);
  const editable = col.kind === "status";
  return `
  <section class="column" data-col="${esc(col.key)}" data-kind="${col.kind}">
    <header class="col-head">
      <span class="col-swatch" style="background:${esc(col.color)}"></span>
      <span class="col-name" ${editable ? 'contenteditable="true" spellcheck="false"' : ""}
            data-col-name="${esc(col.key)}">${esc(col.title)}</span>
      <span class="col-count">${cards.length}</span>
      ${openings > cards.length ? `<span class="col-openings">${openings} seats</span>` : ""}
      <span class="spacer"></span>
      ${editable ? `<button class="icon-btn" data-act="del-column" data-col="${esc(col.key)}" title="Delete column" aria-label="Delete column">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>` : ""}
    </header>
    <div class="col-cards" data-drop="${esc(col.key)}">
      ${cards.map(cardHTML).join("")}
    </div>
    <div class="col-foot">
      <button class="add-card" data-act="add-card" data-col="${esc(col.key)}">+ Add a role</button>
    </div>
  </section>`;
}

function cardHTML(c) {
  const due = fmtDue(c.dueDate);
  const tags = (c.tags || []).slice(0, 4);
  const sub = [];
  if (c.department) sub.push(`<span>🏷️ ${esc(c.department)}</span>`);
  if (c.location) sub.push(`<span>📍 ${esc(c.location)}</span>`);
  if (Number(c.openings) > 1) sub.push(`<span>× ${Number(c.openings)} openings</span>`);
  if (Number(c.candidates) > 0) sub.push(`<span>👥 ${Number(c.candidates)} in pipeline</span>`);

  return `
  <article class="card" data-id="${esc(c.id)}" data-priority="${esc(c.priority || "normal")}" tabindex="0">
    <div class="card-title">${esc(c.title || "Untitled role")}</div>
    ${sub.length ? `<div class="card-sub">${sub.join("")}</div>` : ""}
    ${tags.length ? `<div class="card-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="card-foot">
      <span class="who">
        ${c.owner
          ? `<span class="pip" style="background:${esc(colorFor(c.owner))}">${esc(initials(c.owner))}</span><b>${esc(c.owner)}</b>`
          : `<span class="pip is-empty">?</span><span class="muted">Unassigned</span>`}
      </span>
      <span class="spacer"></span>
      ${due.text ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ""}
    </div>
  </article>`;
}

function renderOwnerFilterChips() {
  const wrap = $("#ownerChips");
  const owners = allOwners();
  wrap.innerHTML =
    owners.map((o) => `<button class="chip${state.filters.owners.has(o) ? " is-on" : ""}" data-owner="${esc(o)}">${esc(o)}</button>`).join("") +
    `<button class="chip${state.filters.owners.has("__none__") ? " is-on" : ""}" data-owner="__none__">Unassigned</button>`;
}

function refreshDatalists() {
  $("#ownerList").innerHTML = allOwners().map((o) => `<option value="${esc(o)}">`).join("");
  $("#deptList").innerHTML = departments().map((d) => `<option value="${esc(d)}">`).join("");
}

function renderActivity(items) {
  $("#activityList").innerHTML = (items || []).length
    ? items.map((a) => `<li>${esc(a.text)} <em class="muted">— ${esc(a.who || "")}</em><time>${esc(fmtWhen(a.ts))}</time></li>`).join("")
    : `<li class="muted">Nothing yet.</li>`;
}

/* ============================================================
   Chrome wiring
   ============================================================ */
function wireChrome() {
  $("#signInBtn").addEventListener("click", async () => {
    $("#authError").hidden = true;
    try { await store.signIn(); }
    catch (e) {
      if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return;
      const box = $("#authError");
      box.textContent = e?.code === "auth/unauthorized-domain"
        ? `This site's address isn't allowed in Firebase yet. Add "${location.hostname}" under Authentication → Settings → Authorized domains.`
        : (e?.message || "Sign-in failed.");
      box.hidden = false;
    }
  });

  $("#demoBtn").addEventListener("click", () => {
    location.href = location.pathname + "?demo=1";
  });

  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("kanban:theme", next);
  });

  $("#search").addEventListener("input", debounce((e) => {
    state.search = e.target.value;
    render();
  }, 180));

  $$(".seg-btn").forEach((b) => b.addEventListener("click", () => {
    $$(".seg-btn").forEach((x) => x.classList.toggle("is-active", x === b));
    state.view = b.dataset.view;
    render();
  }));

  $("#filterBtn").addEventListener("click", () => {
    const tray = $("#filterTray");
    tray.hidden = !tray.hidden;
  });

  $("#filterTray").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) {
      const { owner, priority, flag } = chip.dataset;
      const set = owner ? state.filters.owners : priority ? state.filters.priorities : state.filters.flags;
      const val = owner || priority || flag;
      set.has(val) ? set.delete(val) : set.add(val);
      chip.classList.toggle("is-on");
      render();
    }
    if (e.target.id === "clearFilters") clearFilters();
  });

  $("#emptyState").addEventListener("click", (e) => {
    if (e.target.dataset.act === "clear-filters") clearFilters();
  });

  /* account menu */
  $("#menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#accountMenu").hidden = !$("#accountMenu").hidden;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#accountMenu") && !e.target.closest("#menuBtn")) $("#accountMenu").hidden = true;
  });
  $("#accountMenu").addEventListener("click", (e) => {
    const act = e.target.closest(".pop-item")?.dataset.act;
    if (!act) return;
    $("#accountMenu").hidden = true;
    if (act === "signout") store.signOut();
    if (act === "members") openMembers();
    if (act === "activity") $("#activityDialog").showModal();
    if (act === "export-csv") exportCSV();
    if (act === "export-json") exportJSON();
  });

  /* board title */
  const title = $("#boardTitle");
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  title.addEventListener("blur", () => {
    const name = title.textContent.trim().slice(0, 80) || "HR Board";
    title.textContent = name;
    if (name !== state.board.name) store.saveBoard({ name });
  });

  /* board delegation */
  $("#board").addEventListener("click", onBoardClick);
  $("#board").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openCard(e.target.dataset.id);
  });
  $("#board").addEventListener("focusout", (e) => {
    const el = e.target.closest?.("[data-col-name]");
    if (el) renameColumn(el.dataset.colName, el.textContent);
  });
  $("#board").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.hasAttribute?.("data-col-name")) { e.preventDefault(); e.target.blur(); }
  });

  initDrag();
  wireCardDialog();
  wireMembersDialog();

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
}

function clearFilters() {
  state.filters.owners.clear();
  state.filters.priorities.clear();
  state.filters.flags.clear();
  $$("#filterTray .chip").forEach((c) => c.classList.remove("is-on"));
  render();
}

function applyTheme(t) { document.documentElement.dataset.theme = t; }
function preferredTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 2400);
}

/* ============================================================
   Board actions
   ============================================================ */
function onBoardClick(e) {
  const act = e.target.closest("[data-act]")?.dataset.act;

  if (act === "add-card") {
    const colKey = e.target.closest("[data-act]").dataset.col;
    const seed = state.view === "owner"
      ? { owner: colKey === "__none__" ? "" : colKey, columnId: activeStatusColumns()[0].id }
      : { columnId: colKey };
    openCard(null, seed);
    return;
  }
  if (act === "add-column") return addColumn();
  if (act === "del-column") return deleteColumn(e.target.closest("[data-act]").dataset.col);

  const card = e.target.closest(".card");
  if (card && !card.classList.contains("is-ghost")) openCard(card.dataset.id);
}

const activeStatusColumns = () =>
  state.board?.columns?.length ? state.board.columns : DEFAULT_COLUMNS;

async function addColumn() {
  const cols = [...activeStatusColumns()];
  cols.push({ id: uid("col"), title: "New column", color: "#94a3b8" });
  await store.saveBoard({ columns: cols });
  store.logActivity("added a column");
}

async function renameColumn(id, text) {
  const cols = activeStatusColumns().map((c) => ({ ...c }));
  const col = cols.find((c) => c.id === id);
  const title = String(text).trim().slice(0, 40);
  if (!col || !title || col.title === title) { render(); return; }
  const old = col.title;
  col.title = title;
  await store.saveBoard({ columns: cols });
  store.logActivity(`renamed column “${old}” to “${title}”`);
}

async function deleteColumn(id) {
  const cols = activeStatusColumns();
  if (cols.length <= 1) return toast("A board needs at least one column.");
  const inCol = state.cards.filter((c) => c.columnId === id);
  const col = cols.find((c) => c.id === id);
  if (inCol.length && !confirm(`“${col.title}” holds ${inCol.length} card(s). They'll move to “${cols[0].id === id ? cols[1].title : cols[0].title}”. Continue?`)) return;

  const fallback = cols.find((c) => c.id !== id).id;
  await Promise.all(inCol.map((c) => store.upsertCard({ ...c, columnId: fallback })));
  await store.saveBoard({ columns: cols.filter((c) => c.id !== id) });
  store.logActivity(`deleted column “${col.title}”`);
}

/* ============================================================
   Card dialog
   ============================================================ */
function openCard(id, seed = {}) {
  const dlg = $("#cardDialog");
  const card = id ? state.cards.find((c) => c.id === id) : null;
  state.editingId = id;

  $("#f_column").innerHTML = activeStatusColumns()
    .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
  refreshDatalists();

  const d = card || makeCard(seed);
  $("#f_title").value = d.title || "";
  $("#f_owner").value = d.owner || "";
  $("#f_column").value = d.columnId || activeStatusColumns()[0].id;
  $("#f_priority").value = d.priority || "normal";
  $("#f_due").value = d.dueDate || "";
  $("#f_dept").value = d.department || "";
  $("#f_location").value = d.location || "";
  $("#f_openings").value = d.openings ?? 1;
  $("#f_candidates").value = d.candidates ?? 0;
  $("#f_tags").value = (d.tags || []).join(", ");
  $("#f_notes").value = d.notes || "";

  $("#deleteCardBtn").hidden = !card;
  $("#cardMeta").textContent = card
    ? `Last updated ${fmtWhen(card.updatedAt)}${card.updatedBy ? ` by ${card.updatedBy}` : ""}`
    : "";

  dlg.showModal();
  setTimeout(() => $("#f_title").focus(), 40);
}

function wireCardDialog() {
  $("#cardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const existing = state.editingId ? state.cards.find((c) => c.id === state.editingId) : null;
    const patch = {
      title: $("#f_title").value.trim(),
      owner: $("#f_owner").value.trim(),
      columnId: $("#f_column").value,
      priority: $("#f_priority").value,
      dueDate: $("#f_due").value,
      department: $("#f_dept").value.trim(),
      location: $("#f_location").value.trim(),
      openings: Math.max(1, Number($("#f_openings").value) || 1),
      candidates: Math.max(0, Number($("#f_candidates").value) || 0),
      tags: parseTags($("#f_tags").value),
      notes: $("#f_notes").value.trim(),
    };
    if (!patch.title) return;

    const card = existing ? { ...existing, ...patch } : makeCard({ ...patch, order: nextOrder(patch.columnId) });
    await store.upsertCard(card);
    store.logActivity(existing ? `updated “${card.title}”` : `added “${card.title}”`);
    $("#cardDialog").close();
    toast(existing ? "Saved" : "Role added");
  });

  $("#deleteCardBtn").addEventListener("click", async () => {
    const card = state.cards.find((c) => c.id === state.editingId);
    if (!card || !confirm(`Delete “${card.title}”? This can't be undone.`)) return;
    await store.deleteCard(card.id);
    store.logActivity(`deleted “${card.title}”`);
    $("#cardDialog").close();
    toast("Deleted");
  });
}

function nextOrder(columnId) {
  const inCol = state.cards.filter((c) => c.columnId === columnId);
  return inCol.length ? Math.max(...inCol.map((c) => c.order ?? 0)) + 1000 : 1000;
}

/* ============================================================
   People — assignees (no account) and board access (accounts)
   ============================================================ */
function openMembers() {
  renderAssignees();
  renderMembers();
  $("#membersDialog").showModal();
}

/** The roster of people work can be assigned to. No sign-in involved. */
function renderAssignees() {
  const names = state.board?.assignees || [];
  const count = (n) => state.cards.filter((c) => c.owner === n).length;
  $("#assigneeList").innerHTML = names.length
    ? names.map((n) => `<li>
        <span class="pip" style="background:${esc(colorFor(n))}">${esc(initials(n))}</span>
        <span>${esc(n)}</span>
        <span class="role">${count(n)} ${count(n) === 1 ? "role" : "roles"}</span>
        <button class="icon-btn" data-drop-assignee="${esc(n)}" title="Remove from list" aria-label="Remove ${esc(n)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </li>`).join("")
    : `<li class="muted small">No one yet — add the people you assign roles to.</li>`;
}

function renderMembers() {
  const me = store.user?.email || "";
  const owner = state.board?.ownerEmail || "";
  const members = state.board?.members?.length
    ? state.board.members
    : (state.board?.allowedEmails || []).map((e) => ({ email: e, role: "member" }));

  $("#memberList").innerHTML = members.map((m) => {
    const label = m.name || m.email;
    const isOwner = m.email === owner;
    return `<li>
      <span class="pip" style="background:${esc(colorFor(label))}">${esc(initials(label))}</span>
      <span>${esc(label)}${m.name ? `<br><span class="muted small">${esc(m.email)}</span>` : ""}</span>
      <span class="role">${isOwner ? "owner" : "member"}</span>
      ${!isOwner && me === owner
        ? `<button class="icon-btn" data-remove="${esc(m.email)}" title="Remove" aria-label="Remove ${esc(label)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
        : ""}
    </li>`;
  }).join("");
}

function wireMembersDialog() {
  $("#assigneeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#assigneeName").value.trim().replace(/\s+/g, " ");
    if (!name) return;
    const assignees = [...(state.board.assignees || [])];
    if (assignees.some((a) => a.toLowerCase() === name.toLowerCase())) return toast("Already on the list.");
    assignees.push(name);
    assignees.sort((a, b) => a.localeCompare(b));
    await store.saveBoard({ assignees });
    store.logActivity(`added ${name} as an assignee`);
    $("#assigneeName").value = "";
    renderAssignees();
    refreshDatalists();
    toast(`${name} added`);
  });

  $("#assigneeList").addEventListener("click", async (e) => {
    const name = e.target.closest("[data-drop-assignee]")?.dataset.dropAssignee;
    if (!name) return;
    const held = state.cards.filter((c) => c.owner === name).length;
    const warn = held
      ? `${name} still owns ${held} role(s). They stay assigned and ${name} keeps showing as a column until you move them. Remove from the list anyway?`
      : `Remove ${name} from the assignee list?`;
    if (!confirm(warn)) return;
    const assignees = (state.board.assignees || []).filter((a) => a !== name);
    await store.saveBoard({ assignees });
    store.logActivity(`removed ${name} from the assignee list`);
    renderAssignees();
    refreshDatalists();
  });

  $("#inviteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#inviteEmail").value.trim().toLowerCase();
    if (!email) return;
    const members = [...(state.board.members || [])];
    if (members.some((m) => m.email === email)) return toast("Already on the list.");
    members.push({ email, name: "", role: "member" });
    await store.saveBoard({ members, allowedEmails: members.map((m) => m.email) });
    store.logActivity(`gave ${email} access`);
    $("#inviteEmail").value = "";
    renderMembers();
    toast("Added — they can sign in with Google now.");
  });

  $("#memberList").addEventListener("click", async (e) => {
    const email = e.target.closest("[data-remove]")?.dataset.remove;
    if (!email || !confirm(`Remove ${email} from this board?`)) return;
    const members = (state.board.members || []).filter((m) => m.email !== email);
    await store.saveBoard({ members, allowedEmails: members.map((m) => m.email) });
    store.logActivity(`removed ${email}`);
    renderMembers();
  });
}

/* ============================================================
   Export
   ============================================================ */
function exportCSV() {
  const colTitle = Object.fromEntries(activeStatusColumns().map((c) => [c.id, c.title]));
  const rows = [[
    "Role", "Owner", "Status", "Priority", "Department", "Location",
    "Openings", "Candidates", "Target date", "Tags", "Notes", "Last updated",
  ]];
  state.cards
    .slice()
    .sort((a, b) => (a.columnId || "").localeCompare(b.columnId || "") || (a.order ?? 0) - (b.order ?? 0))
    .forEach((c) => rows.push([
      c.title, c.owner, colTitle[c.columnId] || c.columnId, c.priority,
      c.department, c.location, c.openings, c.candidates, c.dueDate,
      (c.tags || []).join("; "), c.notes,
      c.updatedAt ? new Date(c.updatedAt).toISOString().slice(0, 10) : "",
    ]));
  downloadFile(`hr-board-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + toCSV(rows), "text/csv");
  toast("CSV downloaded");
}

function exportJSON() {
  downloadFile(
    `hr-board-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ board: state.board, cards: state.cards }, null, 2),
    "application/json",
  );
  toast("Backup downloaded");
}

/* ============================================================
   Drag & drop — pointer based, so it works on touch too
   ============================================================ */
function initDrag() {
  const boardEl = $("#board");
  const wrap = $("#boardWrap");
  let drag = null;
  let raf = 0;

  boardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const card = e.target.closest(".card");
    if (!card || e.target.closest("button, a, input, [contenteditable='true']")) return;

    drag = {
      id: card.dataset.id, el: card, started: false,
      sx: e.clientX, sy: e.clientY, pointerId: e.pointerId,
      layer: null, line: null, target: null,
    };
    boardEl.setPointerCapture(e.pointerId);
  });

  boardEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;

    if (!drag.started) {
      if (Math.hypot(dx, dy) < 6) return;
      startVisualDrag();
    }

    drag.layer.style.transform =
      `translate(${e.clientX - drag.grabX}px, ${e.clientY - drag.grabY}px) rotate(1.5deg)`;
    placeLine(e.clientX, e.clientY);
    autoScroll(e.clientX, e.clientY);
    e.preventDefault();
  });

  const finish = async (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(raf); raf = 0;
    document.body.classList.remove("is-dragging");
    stopScroll();

    if (!d.started) return;

    /* Read the marker's position BEFORE detaching it from the DOM —
       once removed it has no parent and the drop slot is lost. */
    const slot = d.target ? readSlot(d.line, d.id) : null;

    d.layer?.remove();
    d.line?.remove();
    d.el.classList.remove("is-ghost");

    if (!d.target) { render(); return; }
    await commitMove(d.id, d.target, slot);
  };
  boardEl.addEventListener("pointerup", finish);
  boardEl.addEventListener("pointercancel", finish);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag?.started) {
      drag.layer?.remove(); drag.line?.remove();
      drag.el.classList.remove("is-ghost");
      drag = null;
      document.body.classList.remove("is-dragging");
      stopScroll();
      render();
    }
  });

  function startVisualDrag() {
    const rect = drag.el.getBoundingClientRect();
    drag.started = true;
    drag.grabX = drag.sx - rect.left;
    drag.grabY = drag.sy - rect.top;

    const layer = drag.el.cloneNode(true);
    layer.classList.add("drag-layer");
    layer.style.left = "0px";
    layer.style.top = "0px";
    layer.style.width = `${rect.width}px`;
    layer.style.transform = `translate(${rect.left}px, ${rect.top}px) rotate(1.5deg)`;
    document.body.appendChild(layer);

    drag.layer = layer;
    drag.line = Object.assign(document.createElement("div"), { className: "drop-line" });
    drag.el.classList.add("is-ghost");
    document.body.classList.add("is-dragging");
  }

  /** Put the insertion marker where the pointer is. */
  function placeLine(x, y) {
    const zone = zoneAt(x, y);
    $$(".column").forEach((c) => c.classList.toggle("is-dropzone", c.contains(zone)));
    if (!zone) { drag.target = null; drag.line.remove(); return; }
    drag.target = zone.dataset.drop;

    const siblings = [...zone.querySelectorAll(".card")].filter((c) => c !== drag.el);
    const after = siblings.find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    after ? zone.insertBefore(drag.line, after) : zone.appendChild(drag.line);
  }

  function zoneAt(x, y) {
    for (const z of $$(".col-cards")) {
      const col = z.closest(".column").getBoundingClientRect();
      if (x >= col.left && x <= col.right && y >= col.top && y <= col.bottom) return z;
    }
    return null;
  }

  /* edge auto-scroll */
  let scrollVec = { x: 0, y: 0, el: null };
  function autoScroll(x, y) {
    const r = wrap.getBoundingClientRect();
    const EDGE = 70;
    scrollVec.x = x < r.left + EDGE ? -14 : x > r.right - EDGE ? 14 : 0;

    const zone = zoneAt(x, y);
    let vy = 0;
    if (zone) {
      const zr = zone.getBoundingClientRect();
      vy = y < zr.top + 40 ? -10 : y > zr.bottom - 40 ? 10 : 0;
    }
    scrollVec.y = vy;
    scrollVec.el = zone;

    if (!raf && (scrollVec.x || scrollVec.y)) tick();
  }
  function tick() {
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (scrollVec.x) wrap.scrollLeft += scrollVec.x;
      if (scrollVec.y && scrollVec.el) scrollVec.el.scrollTop += scrollVec.y;
      if (scrollVec.x || scrollVec.y) tick();
    });
  }
  function stopScroll() {
    scrollVec = { x: 0, y: 0, el: null };
    $$(".column").forEach((c) => c.classList.remove("is-dropzone"));
  }
}

/** Snapshot the neighbours around the drop marker while it's still in the DOM. */
function readSlot(lineEl, dragId) {
  const zone = lineEl?.parentElement;
  if (!zone) return null;
  const kids = [...zone.children];
  const idx = kids.indexOf(lineEl);
  const isOther = (k) => k.classList?.contains("card") && k.dataset.id !== dragId;
  const orderOf = (el) => {
    const c = state.cards.find((x) => x.id === el?.dataset?.id);
    return c ? c.order ?? 0 : null;
  };
  return {
    before: orderOf(kids.slice(0, idx).reverse().find(isOther)),
    after: orderOf(kids.slice(idx + 1).find(isOther)),
  };
}

/** Work out the new bucket + order from the recorded slot, then save. */
async function commitMove(cardId, targetKey, slot) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return render();

  const patch = { order: slot ? orderBetween(slot.before, slot.after) : card.order ?? 0 };
  let note = "";

  if (state.view === "owner") {
    const owner = targetKey === "__none__" ? "" : targetKey;
    if (owner !== card.owner) {
      patch.owner = owner;
      note = `moved \u201c${card.title}\u201d to ${owner || "Unassigned"}`;
    }
  } else if (targetKey !== card.columnId) {
    patch.columnId = targetKey;
    const col = activeStatusColumns().find((c) => c.id === targetKey);
    note = `moved \u201c${card.title}\u201d to ${col?.title || targetKey}`;
  }

  await store.upsertCard({ ...card, ...patch });
  if (note) store.logActivity(note);
}
