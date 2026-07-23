import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Label } from './Typo';
import { palette } from '../tokens';

interface HeatmapGridProps {
  values: readonly number[];
  columns?: number;
  colorRgb?: string;
  minAlpha?: number;
  maxAlpha?: number;
  cellRadius?: number;
  gap?: number;
  dayLabels?: readonly string[];
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function HeatmapGrid({
  values,
  columns = 7,
  colorRgb = '99,184,168',
  minAlpha = 0.15,
  maxAlpha = 0.9,
  cellRadius = 8,
  gap = 7,
  dayLabels,
  delay = 0,
  style,
}: HeatmapGridProps) {
  const [width, setWidth] = useState(0);
  const cell = width > 0 ? (width - gap * (columns - 1)) / columns : 0;

  const rows: number[][] = [];
  for (let i = 0; i < values.length; i += columns) {
    rows.push(values.slice(i, i + columns) as number[]);
  }

  return (
    <View style={style} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {cell > 0 && (
        <View style={{ gap }}>
          {rows.map((row, r) => (
            <View key={r} style={{ flexDirection: 'row', gap }}>
              {row.map((v, c) => (
                <Animated.View
                  key={c}
                  entering={FadeIn.delay(delay + (r * columns + c) * 16).duration(400)}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: cellRadius,
                    backgroundColor: `rgba(${colorRgb},${(minAlpha + v * (maxAlpha - minAlpha)).toFixed(2)})`,
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      )}
      {cell > 0 && dayLabels && (
        <View style={{ flexDirection: 'row', gap, marginTop: 8 }}>
          {dayLabels.map((d, i) => (
            <View key={i} style={{ width: cell, alignItems: 'center' }}>
              <Label size={8} em={0.05} color={palette.faint}>
                {d}
              </Label>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
