import {
  Sora_200ExtraLight,
  Sora_300Light,
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  useFonts,
} from '@expo-google-fonts/sora';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { hapticsAvailable, palette } from '@kore/ui';
import { registerBackgroundSync } from '@/ring/background';
import { syncRing } from '@/ring/sync';
import { useHealthStore } from '@/store/health';

// Dev-only handle so the Metro debugger can read/seed app state directly
// (used by the visual design loop to mirror the phone's real dataset into
// the simulator). Stripped from release bundles by __DEV__ gating.
if (__DEV__) {
  (globalThis as unknown as Record<string, unknown>).__koreStore = useHealthStore;
  (globalThis as unknown as Record<string, unknown>).__koreHapticsAvailable = hapticsAvailable;
}

SplashScreen.preventAutoHideAsync();

// Auto-sync when the app comes to the foreground: paired ring only, and no
// more than once per 5 minutes so reopening the app doesn't hammer the ring.
// In dev builds the cooldown drops to 30s for quick iteration (the expensive
// dev audit no longer runs per sync — it is gated to once per session).
const AUTO_SYNC_MIN_INTERVAL_MS = __DEV__ ? 30_000 : 5 * 60 * 1000;

function maybeAutoSync() {
  // The retry interval fires regardless of app state — never attempt BLE
  // while backgrounded (that needs the bluetooth-central background mode,
  // which this app does not have; see ring/background.ts).
  if (AppState.currentState !== 'active') return;
  const { ringDeviceId, connectionStatus, lastSyncAt } = useHealthStore.getState();
  if (!ringDeviceId) return;
  // Anything other than 'disconnected' means a sync/connect is already
  // running — the interval tick must not stack another one.
  if (connectionStatus !== 'disconnected') return;
  if (lastSyncAt != null && Date.now() - lastSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;
  console.log('[sync] auto-sync on foreground');
  void syncRing();
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Sora_200ExtraLight,
    Sora_300Light,
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    void registerBackgroundSync();
    maybeAutoSync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeAutoSync();
    });
    // While the app stays open, retry on a cadence — when the ring is nearby
    // the next tick picks it up; the 5-minute cooldown in maybeAutoSync keeps
    // this from hammering the ring.
    const timer = setInterval(maybeAutoSync, AUTO_SYNC_MIN_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.porcelain },
        }}
      />
    </>
  );
}
