import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { type ScreenKey } from '../tokens';

// Porcelain base with two soft brand glows: Penna blue off the top-right
// corner and Hudson blush off the bottom-left.
const PENNA = 'rgba(185,199,224,0.45)';
const HUDSON = 'rgba(235,219,211,0.6)';

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground(_props: AuraBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const r = (width * 1.7) / 2;
  const top = vec(width, -r * 0.1);
  const bottom = vec(-r * 0.2, height + r * 0.2);
  return (
    <>
      <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
        <Circle c={top} r={r}>
          <RadialGradient c={top} r={r} colors={[PENNA, 'rgba(185,199,224,0)']} />
        </Circle>
        <Circle c={bottom} r={r}>
          <RadialGradient c={bottom} r={r} colors={[HUDSON, 'rgba(235,219,211,0)']} />
        </Circle>
      </Canvas>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}
