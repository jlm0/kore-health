import React from 'react';
import { View } from 'react-native';
import { gradients, palette } from '../tokens';
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 104 }}>
        <Label size={9} em={0.08} color={palette.slate}>
          {label}
        </Label>
      </View>
      <ProgressBar
        progress={progress}
        colors={warn ? gradients.activity : gradients.readiness}
        delay={delay}
        style={{ flex: 1 }}
      />
    </View>
  );
}
