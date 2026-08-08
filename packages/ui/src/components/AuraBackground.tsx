import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, useWindowDimensions } from 'react-native';
import { type ScreenKey } from '../tokens';

// Neutral light backdrop: a barely-there vertical gradient (cool white into
// the screen base grey) plus a whisper dot-grid — the frosted cards need a
// quiet textured field to float on; hue lives in the data.
const TOP = 'rgba(255,255,255,0.9)';
const MID = 'rgba(255,255,255,0.35)';
const BOTTOM = 'rgba(244,245,247,0)';

const dotGrid = require('../../assets/dotgrid.png');

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground(_props: AuraBackgroundProps) {
  const { width, height } = useWindowDimensions();
  return (
    <>
      <LinearGradient
        colors={[TOP, MID, BOTTOM]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={dotGrid}
        style={{ position: 'absolute', top: 0, left: 0, width, height, opacity: 0.6 }}
        resizeMode="repeat"
      />
    </>
  );
}
