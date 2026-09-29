import AsyncStorage from '@react-native-async-storage/async-storage';

// TestFlight builds have no console, so ring log lines are kept on the phone
// (persisted, so a force-quit keeps them) for the debug console's Share button.

const STORAGE_KEY = 'kore-sync-log';
const MAX_LINES = 1500;
const FLUSH_DELAY_MS = 2_000;
const CAPTURED = /^\[(sync|ble|pair|ring-debug|audit)\]/;
// A 16-byte auth key in hex; the log is shared, the key must never leave the phone.
const AUTH_KEY_HEX = /\b[0-9a-f]{32}\b/gi;

let lines: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function record(message: string): void {
  lines.push(`${new Date().toISOString()} ${message.replace(AUTH_KEY_HEX, '<key redacted>')}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

function flush(): void {
  flushTimer = null;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lines)).catch(() => {});
}

/** Start keeping ring log lines; idempotent. Call once at app start. */
export async function installSyncLogCapture(): Promise<void> {
  if (installed) return;
  installed = true;
  const original = console.log;
  console.log = (...args: unknown[]) => {
    original(...args);
    if (typeof args[0] === 'string' && CAPTURED.test(args[0])) record(args.map(String).join(' '));
  };
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) lines = [...(JSON.parse(saved) as string[]), ...lines].slice(-MAX_LINES);
  } catch {
    // Unreadable history just starts the log fresh.
  }
}

export function syncLogText(): string {
  return lines.join('\n');
}

export function clearSyncLog(): void {
  lines = [];
  flush();
}
