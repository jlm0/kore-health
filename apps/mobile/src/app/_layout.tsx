import {
  Fraunces_300Light,
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
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
import { registerBackgroundSync } from '@/ring/background';
import { syncRing } from '@/ring/sync';
import { useHealthStore } from '@/store/health';

SplashScreen.preventAutoHideAsync();

// Auto-sync when the app comes to the foreground: paired ring only, and no
// more than once per 5 minutes so reopening the app doesn't hammer the ring.
// In dev builds the cooldown drops to 30s to keep the audit loop quick.
const AUTO_SYNC_MIN_INTERVAL_MS = __DEV__ ? 30_000 : 5 * 60 * 1000;

function maybeAutoSync() {
  const { ringDeviceId, connectionStatus, lastSyncAt } = useHealthStore.getState();
  if (!ringDeviceId) return;
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
    Fraunces_300Light,
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
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
          contentStyle: { backgroundColor: '#E8ECF2' },
        }}
      />
    </>
  );
}
