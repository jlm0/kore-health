import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { auraPresets, screenGradients, type ScreenKey } from '../tokens';

const DESIGN_WIDTH = 402;

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground({ screen }: AuraBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const scale = width / DESIGN_WIDTH;
  const [top, bottom] = screenGradients[screen];

  return (
    <>
      <LinearGradient colors={[top, bottom]} style={StyleSheet.absoluteFill} />
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {auraPresets[screen].map((blob, i) => {
          const cx = blob.cx * scale;
          const cy = Math.min(blob.cy * scale, height + blob.r);
          const r = blob.r * scale;
          return (
            <Circle key={i} cx={cx} cy={cy} r={r}>
              <RadialGradient
                c={vec(cx, cy)}
                r={r}
                colors={[blob.color, 'transparent']}
                positions={[0, 0.68]}
              />
            </Circle>
          );
        })}
      </Canvas>
    </>
  );
}
