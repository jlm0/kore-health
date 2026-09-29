import { Canvas, Group, ImageSVG, Skia, type SkSVG } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Route illustrations on a 280×200 artboard, split into three layers so the
// hero shape can float between its backdrop and foreground details.
const ART = {
  readiness: {
    label: "Sun rising inside a readiness ring",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"12\" d=\"M80.9 124.5A64 64 0 1 1 199.1 124.5\"/><path fill=\"none\" stroke=\"#7C7F66\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"12\" d=\"M80.9 124.5A64 64 0 0 1 185.3 54.7\"/>",
    float: "<circle fill=\"#EBDBD3\" cx=\"140\" cy=\"100\" r=\"30\"/>",
    over: "<circle fill=\"#FFFFFF\" cx=\"50\" cy=\"46\" r=\"4\"/><circle fill=\"#FFFFFF\" cx=\"232\" cy=\"38\" r=\"3\"/><circle fill=\"#FFFFFF\" cx=\"238\" cy=\"150\" r=\"5\"/><circle fill=\"#FFFFFF\" cx=\"42\" cy=\"152\" r=\"3\"/>",
  },
  sleep: {
    label: "Crescent moon over a cloud with stars",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/>",
    float: "<path fill=\"#FFFFFF\" d=\"M156 40A48 48 0 1 0 204 104A40 40 0 0 1 156 40Z\"/>",
    over: "<path fill=\"#FFFFFF\" d=\"M70 48L72.2 53.8L78 56L72.2 58.2L70 64L67.8 58.2L62 56L67.8 53.8Z\"/><path fill=\"#FFFFFF\" d=\"M214 46L215.6 50.4L220 52L215.6 53.6L214 58L212.4 53.6L208 52L212.4 50.4Z\"/><path fill=\"#FFFFFF\" d=\"M228 111L229.3 114.7L233 116L229.3 117.3L228 121L226.7 117.3L223 116L226.7 114.7Z\"/><path fill=\"#FFFFFF\" d=\"M98 88L99.1 90.9L102 92L99.1 93.1L98 96L96.9 93.1L94 92L96.9 90.9Z\"/><g><circle fill=\"#FFFFFF\" cx=\"100\" cy=\"146\" r=\"20\"/><circle fill=\"#FFFFFF\" cx=\"128\" cy=\"134\" r=\"26\"/><circle fill=\"#FFFFFF\" cx=\"156\" cy=\"148\" r=\"18\"/><rect fill=\"#FFFFFF\" x=\"80\" y=\"146\" width=\"96\" height=\"20\" rx=\"10\"/></g>",
  },
  activity: {
    label: "A dotted trail over hills to a flag",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/>",
    float: "<circle fill=\"#D08770\" cx=\"196\" cy=\"62\" r=\"20\"/>",
    over: "<path fill=\"#D0BEA3\" d=\"M44 172C76 118 118 114 150 150C172 128 204 122 236 172Z\"/><path fill=\"#FFFFFF\" d=\"M112 172C140 144 180 142 212 172Z\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"5\" stroke-dasharray=\"0.1 11\" d=\"M64 178C96 164 118 174 138 160S164 132 170 118\"/><path fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"3\" d=\"M170 120V82\"/><path fill=\"#1F1F1F\" d=\"M171 82L196 90L171 99Z\"/>",
  },
  trends: {
    label: "Rising bars with a trend line",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/><rect fill=\"#FFFFFF\" x=\"66\" y=\"120\" width=\"26\" height=\"42\" rx=\"9\"/><rect fill=\"#FFFFFF\" x=\"100\" y=\"98\" width=\"26\" height=\"64\" rx=\"9\"/><rect fill=\"#FFFFFF\" x=\"134\" y=\"110\" width=\"26\" height=\"52\" rx=\"9\"/><rect fill=\"#FFFFFF\" x=\"168\" y=\"76\" width=\"26\" height=\"86\" rx=\"9\"/><rect fill=\"#7F88D6\" x=\"202\" y=\"52\" width=\"26\" height=\"110\" rx=\"9\"/><path fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"3\" d=\"M79 104L113 82L147 94L181 60L215 36\"/><circle fill=\"#1F1F1F\" cx=\"79\" cy=\"104\" r=\"4.5\"/><circle fill=\"#1F1F1F\" cx=\"113\" cy=\"82\" r=\"4.5\"/><circle fill=\"#1F1F1F\" cx=\"147\" cy=\"94\" r=\"4.5\"/><circle fill=\"#1F1F1F\" cx=\"181\" cy=\"60\" r=\"4.5\"/><circle fill=\"#1F1F1F\" cx=\"215\" cy=\"36\" r=\"5.5\"/>",
    float: "",
    over: "",
  },
  connect: {
    label: "A ring sending a signal",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/>",
    float: "<circle fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"16\" cx=\"140\" cy=\"100\" r=\"40\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"3\" d=\"M114 78A34 34 0 0 1 146 67\"/>",
    over: "<path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"5\" d=\"M198 74A40 40 0 0 1 198 126\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"5\" d=\"M214 58A62 62 0 0 1 214 142\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"5\" d=\"M82 74A40 40 0 0 0 82 126\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"5\" d=\"M66 58A62 62 0 0 0 66 142\"/>",
  },
  stepOura: {
    label: "A phone linked to a ring",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/><rect fill=\"#FFFFFF\" x=\"62\" y=\"36\" width=\"80\" height=\"140\" rx=\"18\"/><rect fill=\"#B9C7E0\" x=\"74\" y=\"56\" width=\"56\" height=\"38\" rx=\"9\"/><rect fill=\"#B9C7E0\" x=\"74\" y=\"104\" width=\"40\" height=\"8\" rx=\"4\"/><rect fill=\"#B9C7E0\" x=\"74\" y=\"118\" width=\"52\" height=\"8\" rx=\"4\"/><rect fill=\"#1F1F1F\" x=\"88\" y=\"158\" width=\"28\" height=\"4\" rx=\"2\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"4\" stroke-dasharray=\"6 8\" d=\"M148 110C164 104 170 110 178 110\"/>",
    float: "<circle fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"12\" cx=\"208\" cy=\"110\" r=\"26\"/>",
    over: "<circle fill=\"#1F1F1F\" cx=\"200\" cy=\"58\" r=\"15\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M195.5 53.5a4.5 4.5 0 1 1 6.2 4.2c-1.1 0.5-1.7 1.4-1.7 2.6v1\"/><circle fill=\"#FFFFFF\" cx=\"200\" cy=\"66\" r=\"1.7\"/>",
  },
  stepRemove: {
    label: "A phone unlinking from a ring",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/><rect fill=\"#FFFFFF\" x=\"62\" y=\"36\" width=\"80\" height=\"140\" rx=\"18\"/><rect fill=\"#C9CDF5\" x=\"74\" y=\"56\" width=\"56\" height=\"38\" rx=\"9\"/><rect fill=\"#C9CDF5\" x=\"74\" y=\"104\" width=\"40\" height=\"8\" rx=\"4\"/><rect fill=\"#C9CDF5\" x=\"74\" y=\"118\" width=\"52\" height=\"8\" rx=\"4\"/><rect fill=\"#1F1F1F\" x=\"88\" y=\"158\" width=\"28\" height=\"4\" rx=\"2\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"4\" stroke-dasharray=\"6 8\" d=\"M148 110H160\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"4\" stroke-dasharray=\"6 8\" d=\"M186 110H176\"/><circle fill=\"#1F1F1F\" cx=\"168\" cy=\"110\" r=\"11\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2.5\" d=\"M164 106L172 114M172 106L164 114\"/>",
    float: "<circle fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"12\" cx=\"212\" cy=\"110\" r=\"24\"/>",
    over: "",
  },
  stepCharger: {
    label: "A ring resting on its charger",
    under: "<circle fill=\"#FFFFFF\" fill-opacity=\"0.6\" cx=\"140\" cy=\"100\" r=\"90\"/><rect fill=\"#FFFFFF\" x=\"68\" y=\"150\" width=\"144\" height=\"26\" rx=\"13\"/><rect fill=\"#D0BEA3\" x=\"116\" y=\"112\" width=\"48\" height=\"44\" rx=\"14\"/>",
    float: "<circle fill=\"none\" stroke=\"#1F1F1F\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"12\" cx=\"140\" cy=\"94\" r=\"28\"/>",
    over: "<path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"4\" d=\"M96 70A52 52 0 0 1 108 52\"/><path fill=\"none\" stroke=\"#FFFFFF\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"4\" d=\"M184 70A52 52 0 0 0 172 52\"/><path fill=\"#D08770\" d=\"M214 58l-14 22h11l-7 20l20 -27h-11l8 -15Z\"/>",
  },
} as const;

export type IllustrationName = keyof typeof ART;

const VIEW_W = 280;
const VIEW_H = 200;
const cache = new Map<string, SkSVG | null>();

function layer(markup: string): SkSVG | null {
  if (markup.length === 0) return null;
  let svg = cache.get(markup);
  if (svg === undefined) {
    svg = Skia.SVG.MakeFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}">${markup}</svg>`,
    );
    cache.set(markup, svg);
  }
  return svg;
}

interface IllustrationProps {
  name: IllustrationName;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function Illustration({ name, maxWidth = 320, style }: IllustrationProps) {
  const [available, setAvailable] = useState(0);
  const reduceMotion = useReducedMotion();
  const drift = useSharedValue(0);
  const art = ART[name];
  const layers = useMemo(
    () => ({ under: layer(art.under), float: layer(art.float), over: layer(art.over) }),
    [art],
  );

  const width = Math.min(available, maxWidth);
  const height = (width * VIEW_H) / VIEW_W;

  useEffect(() => {
    if (reduceMotion) return;
    drift.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduceMotion, drift]);

  const floatTransform = useDerivedValue(() => [{ translateY: -4 * (width / VIEW_W) * drift.value }]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={art.label}
      onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
      style={[{ alignSelf: 'stretch', alignItems: 'center' }, style]}>
      {width > 0 && (
        <Canvas style={{ width, height }}>
          <ImageSVG svg={layers.under} x={0} y={0} width={width} height={height} />
          <Group transform={floatTransform}>
            <ImageSVG svg={layers.float} x={0} y={0} width={width} height={height} />
          </Group>
          <ImageSVG svg={layers.over} x={0} y={0} width={width} height={height} />
        </Canvas>
      )}
    </View>
  );
}
