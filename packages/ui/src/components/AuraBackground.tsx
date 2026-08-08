import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet } from 'react-native';
import { type ScreenKey } from '../tokens';

// Neutral light backdrop: a barely-there vertical gradient (cool white into
// the screen base grey) replaces the old pastel aura photos — the frosted
// cards need a quiet greyscale field to float on; hue lives in the data.
const TOP = 'rgba(255,255,255,0.9)';
const MID = 'rgba(255,255,255,0.35)';
const BOTTOM = 'rgba(244,245,247,0)';

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground(_props: AuraBackgroundProps) {
  return (
    <LinearGradient
      colors={[TOP, MID, BOTTOM]}
      locations={[0, 0.35, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}
