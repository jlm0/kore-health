import {
  Canvas,
  Circle,
  FractalNoise,
  LinearGradient,
  RadialGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
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

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(width * 0.25, height)}
          colors={[...screenGradients[screen]]}
        />
      </Rect>
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
      <Rect x={0} y={0} width={width} height={height * 0.4}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height * 0.4)}
          colors={['rgba(255,255,255,0.34)', 'rgba(255,255,255,0)']}
        />
      </Rect>
      <Rect x={0} y={0} width={width} height={height} opacity={0.06}>
        <FractalNoise freqX={0.9} freqY={0.9} octaves={3} seed={7} />
      </Rect>
    </Canvas>
  );
}
