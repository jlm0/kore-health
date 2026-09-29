import {
  Button,
  GlassCard,
  Illustration,
  Txt,
  fontFamily,
  palette,
  surfaces,
  type,
  type CardTint,
  type IllustrationName,
} from '@kore/ui';
import React from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

interface JourneyStepProps {
  step: number;
  total: number;
  tint: CardTint;
  art: IllustrationName;
  /** Title split so the closing clause can carry the heavier weight. */
  title: { lead: string; strong: string; tail?: string };
  body: string;
  checklist?: readonly string[];
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}

/** One full-height step of a guided flow: progress, illustration, copy, actions. */
export function JourneyStep({
  step,
  total,
  tint,
  art,
  title,
  body,
  checklist,
  primary,
  secondary,
}: JourneyStepProps) {
  const hasChecklist = checklist != null && checklist.length > 0;
  return (
    <Animated.View key={step} entering={FadeIn.duration(300)} style={{ flex: 1, minHeight: 560 }}>
      <GlassCard
        tint={tint}
        style={{ flex: 1 }}
        contentStyle={{ flex: 1, gap: hasChecklist ? 20 : 24 }}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${step} of ${total}`}
          style={{ flexDirection: 'row', gap: 6 }}>
          {Array.from({ length: total }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: i < step ? palette.ink : surfaces.circleFill,
              }}
            />
          ))}
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Illustration name={art} maxWidth={hasChecklist ? 200 : 320} />
        </View>

        <View style={{ gap: 8 }}>
          <Txt role="label">{`Step ${step} of ${total}`}</Txt>
          <Text accessibilityRole="header" style={[type.display, { fontSize: 28, lineHeight: 33, color: palette.ink }]}>
            {title.lead}
            <Text style={{ fontFamily: fontFamily.semiBold }}>{title.strong}</Text>
            {title.tail ?? ''}
          </Text>
          <Txt role="body">{body}</Txt>
          {hasChecklist ? (
            <View style={{ gap: 12, marginTop: 8 }}>
              {checklist.map((item, i) => (
                <View key={item} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: surfaces.circleFill,
                    }}>
                    <Text style={[type.caption, { fontFamily: fontFamily.semiBold, color: palette.ink }]}>
                      {i + 1}
                    </Text>
                  </View>
                  <Txt role="body" color={palette.ink} style={{ flex: 1, fontFamily: fontFamily.medium }}>
                    {item}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ gap: 8 }}>
          <Button size="lg" onPress={primary.onPress}>
            {primary.label}
          </Button>
          {secondary ? (
            <Button size="lg" variant="ghost" onPress={secondary.onPress}>
              {secondary.label}
            </Button>
          ) : null}
        </View>
      </GlassCard>
    </Animated.View>
  );
}
