import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { screenGradients, spacing, type ScreenKey } from '../tokens';
import { AuraBackground } from './AuraBackground';

interface ScreenProps {
  aura: ScreenKey;
  children: React.ReactNode;
  scroll?: boolean;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({ aura, children, scroll = true, gap = spacing.cardGap, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();

  const padding = {
    paddingTop: insets.top + 12,
    paddingBottom: insets.bottom + 24,
    paddingHorizontal: spacing.screenX,
    gap,
  };

  return (
    <View style={[styles.root, { backgroundColor: screenGradients[aura][0] }]}>
      <AuraBackground screen={aura} />
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[padding, contentStyle]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
});
