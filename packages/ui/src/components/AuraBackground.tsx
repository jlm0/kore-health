import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { type ScreenKey } from '../tokens';

const sources: Record<ScreenKey, ImageSourcePropType> = {
  home: require('../../assets/backgrounds/home.jpg'),
  sleep: require('../../assets/backgrounds/sleep.jpg'),
  readiness: require('../../assets/backgrounds/readiness.jpg'),
  activity: require('../../assets/backgrounds/activity.jpg'),
  trends: require('../../assets/backgrounds/trends.jpg'),
};

const SCRIM = 'rgba(250,251,253,';

const scrims: Record<ScreenKey, [number, number, number, number]> = {
  home: [0.7, 0.32, 0.1, 0.28],
  sleep: [0.68, 0.32, 0.14, 0.32],
  readiness: [0.72, 0.36, 0.14, 0.32],
  activity: [0.66, 0.3, 0.1, 0.28],
  trends: [0.66, 0.3, 0.1, 0.28],
};

interface AuraBackgroundProps {
  screen: ScreenKey;
}

export function AuraBackground({ screen }: AuraBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const [top, upper, mid, bottom] = scrims[screen];
  return (
    <>
      <Image
        source={sources[screen]}
        style={{ position: 'absolute', top: 0, left: 0, width, height }}
        resizeMode="cover"
      />
      <LinearGradient
        colors={[`${SCRIM}${top})`, `${SCRIM}${upper})`, `${SCRIM}${mid})`, `${SCRIM}${bottom})`]}
        locations={[0, 0.24, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}
