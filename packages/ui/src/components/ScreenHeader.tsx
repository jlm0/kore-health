import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, type } from '../tokens';
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
        <Text numberOfLines={1} style={[type.title, styles.title]}>
          {title}
        </Text>
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

/** Short date or context on the right of a ScreenHeader. */
export function HeaderMeta({ children }: { children: string }) {
  return <Text style={[type.caption, { color: palette.muted }]}>{children}</Text>;
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <GlassCircle size={36} onPress={onPress} accessibilityLabel="Back">
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
    minHeight: 48,
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  title: {
    flexShrink: 1,
    color: palette.ink,
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
