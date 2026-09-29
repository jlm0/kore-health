import React from 'react';
import { View } from 'react-native';
import { palette, progressGradients, type } from '../tokens';
import { ProgressBar } from './ProgressBar';
import { Label } from './Typo';

interface ContributorRowProps {
  label: string;
  progress: number;
  warn?: boolean;
  delay?: number;
}

export function ContributorRow({ label, progress, warn = false, delay = 0 }: ContributorRowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ width: 118 }}>
        <Label size={type.caption.fontSize} weight="regular" color={palette.slate} numberOfLines={1}>
          {label}
        </Label>
      </View>
      <ProgressBar
        progress={progress}
        colors={warn ? progressGradients.activity : progressGradients.readiness}
        delay={delay}
        style={{ flex: 1 }}
      />
    </View>
  );
}
