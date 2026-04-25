// format.js — small display helpers. Keep in one file so it's easy to
// swap formatting strategies later (e.g. relative times "3 hours ago").

export function formatTime(s) {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    // Locale-independent compact form: "2026-04-25 14:32"
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return s;
  }
}

export function truncate(s, n = 40) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
