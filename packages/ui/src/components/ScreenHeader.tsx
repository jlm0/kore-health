import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fontFamily, palette } from '../tokens';
import { Chevron } from './Chevron';
import { GlassCircle } from './GlassCircle';

interface ScreenHeaderProps {
  title?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, left, right }: ScreenHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>{left}</View>
      {title != null && (
        <Text
          style={{
            fontSize: 19,
            fontFamily: fontFamily.displayMedium,
            color: palette.ink,
            letterSpacing: 0.2,
          }}>
          {title}
        </Text>
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <GlassCircle size={32} onPress={onPress} accessibilityLabel="Back">
      <Chevron size={9} color={palette.slate} thickness={2} direction="left" style={{ marginLeft: 3 }} />
    </GlassCircle>
  );
}

export function RingIcon({ size = 11, color = palette.mint.base }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2.5,
        borderColor: color,
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  side: {
    minWidth: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  right: {
    justifyContent: 'flex-end',
  },
});
