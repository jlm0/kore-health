import { GlassCard, Illustration, Txt, type CardTint, type IllustrationName } from '@kore/ui';
import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

interface EmptyDataCardProps {
  art: IllustrationName;
  tint: CardTint;
  title: string;
  message: string;
  children?: React.ReactNode;
}

/** Full-height, illustrated empty state for a route before its data exists. */
export function EmptyDataCard({ art, tint, title, message, children }: EmptyDataCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(40).duration(500)} style={{ flex: 1, minHeight: 420 }}>
      <GlassCard
        tint={tint}
        padding={{ horizontal: 24, vertical: 32 }}
        style={{ flex: 1 }}
        contentStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <Illustration name={art} />
        <View style={{ maxWidth: 280, gap: 8 }}>
          <Txt role="title" align="center" style={{ fontSize: 22, lineHeight: 28 }}>
            {title}
          </Txt>
          <Txt role="body" align="center">
            {message}
          </Txt>
        </View>
        {children}
      </GlassCard>
    </Animated.View>
  );
}
