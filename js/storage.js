// localStorage wrapper. Every access is guarded: storage can be unavailable
// (private mode, blocked site data) and the game must still run.
const PREFIX = 'nonogram-color:';

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (_) { /* full or unavailable */ }
}

export function del(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (_) { /* ignore */ }
}

export function has(key) {
  try {
    return localStorage.getItem(PREFIX + key) != null;
  } catch (_) {
    return false;
  }
}

export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch (_) { /* ignore */ }
}
