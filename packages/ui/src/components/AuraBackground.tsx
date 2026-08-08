import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, useWindowDimensions } from 'react-native';
import { type ScreenKey } from '../tokens';

// Neutral light backdrop with real depth: a white-to-base vertical gradient,
// two oversized soft grey washes off-canvas, and a whisper dot-grid. The grey
// washes are what the frosted cards refract — without something behind the
// blur, "glass" just reads as flat white.
const TOP = 'rgba(255,255,255,0.9)';
const MID = 'rgba(255,255,255,0.35)';
const BOTTOM = 'rgba(244,245,247,0)';

const dotGrid = require('../../assets/dotgrid.png');
const blob = require('../../assets/blob.png');

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground(_props: AuraBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const big = width * 1.7;
  return (
    <>
      <LinearGradient
        colors={[TOP, MID, BOTTOM]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={blob}
        style={{
          position: 'absolute',
          top: -big * 0.45,
          right: -big * 0.55,
          width: big,
          height: big,
          opacity: 0.55,
        }}
      />
      <Image
        source={blob}
        style={{
          position: 'absolute',
          bottom: -big * 0.5,
          left: -big * 0.6,
          width: big,
          height: big,
          opacity: 0.4,
        }}
      />
      <Image
        source={dotGrid}
        style={{ position: 'absolute', top: 0, left: 0, width, height, opacity: 0.7 }}
        resizeMode="repeat"
      />
    </>
  );
}
