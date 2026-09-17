export const uid = (p = "id") =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Stable pleasant colour per person, so the same owner always looks the same. */
const PALETTE = ["#6366f1","#0ea5e9","#14b8a6","#f59e0b","#ec4899",
                 "#8b5cf6","#10b981","#ef4444","#3b82f6","#a855f7"];
export function colorFor(name) {
  const s = String(name || "").trim().toLowerCase();
  if (!s) return "#94a3b8";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Days from today to an ISO date; negative = past. */
export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

export function fmtDue(iso) {
  const n = daysUntil(iso);
  if (n === null) return { text: "", cls: "" };
  const nice = new Date(iso + "T00:00:00")
    .toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (n < 0) return { text: `${nice} · ${Math.abs(n)}d late`, cls: "is-over" };
  if (n === 0) return { text: `${nice} · today`, cls: "is-soon" };
  if (n <= 7) return { text: `${nice} · ${n}d`, cls: "is-soon" };
  return { text: nice, cls: "" };
}

export function fmtWhen(ms) {
  if (!ms) return "";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function debounce(fn, ms = 400) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const parseTags = (s) =>
  String(s || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12);

/** Midpoint ordering: reorder one card without rewriting its neighbours. */
export function orderBetween(before, after) {
  if (before == null && after == null) return 1000;
  if (before == null) return after - 1000;
  if (after == null) return before + 1000;
  return (before + after) / 2;
}

export function downloadFile(name, text, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCSV(rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
