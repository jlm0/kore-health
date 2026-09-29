import { describe, expect, it, mock } from 'bun:test';

// Tests for the on-device ring log that testers share from the debug console:
// only ring-tagged lines are kept, auth keys never leave the phone, and a log
// saved before a force-quit is restored ahead of new lines.

const storage = new Map<string, string>([
  ['kore-sync-log', JSON.stringify(['2026-09-28T10:00:00.000Z [sync] from last launch'])],
]);

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

const { installSyncLogCapture, syncLogText, clearSyncLog } = await import('../syncLog');

const silence = console.log;
console.log = () => {};
await installSyncLogCapture();

describe('sync log capture', () => {
  it('restores the previous launch and keeps only ring-tagged lines', () => {
    console.log('[sync] connecting');
    console.log('unrelated app noise');
    console.log('[ble] link up', 42);
    const text = syncLogText();
    expect(text.split('\n')[0]).toContain('[sync] from last launch');
    expect(text).toContain('[sync] connecting');
    expect(text).toContain('[ble] link up 42');
    expect(text).not.toContain('unrelated app noise');
  });

  it('redacts 16-byte hex auth keys', () => {
    console.log('[ring-debug] key installed and stored: 00112233445566778899aabbccddeeff');
    expect(syncLogText()).toContain('key installed and stored: <key redacted>');
    expect(syncLogText()).not.toContain('00112233445566778899aabbccddeeff');
  });

  it('keeps the newest 1500 lines', () => {
    clearSyncLog();
    for (let i = 0; i < 1600; i++) console.log(`[sync] line ${i}`);
    const kept = syncLogText().split('\n');
    expect(kept).toHaveLength(1500);
    expect(kept[0]).toContain('[sync] line 100');
    console.log = silence;
  });
});
