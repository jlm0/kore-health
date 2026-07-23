import { Skia, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';

export interface ChartPoint {
  x: number;
  y: number;
}

export function scalePoints(
  data: readonly number[],
  width: number,
  height: number,
  pad = 4,
  domain?: [number, number],
): ChartPoint[] {
  if (data.length === 0) return [];
  const min = domain ? domain[0] : Math.min(...data);
  const max = domain ? domain[1] : Math.max(...data);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return data.map((v, i) => ({
    x: pad + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: pad + innerH - ((v - min) / span) * innerH,
  }));
}

function appendSmoothLine(builder: SkPathBuilder, points: ChartPoint[]): void {
  builder.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    builder.cubicTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
}

export function smoothLinePath(points: ChartPoint[]): SkPath {
  const builder = Skia.PathBuilder.Make();
  if (points.length > 0) appendSmoothLine(builder, points);
  return builder.detach();
}

export function smoothAreaPath(points: ChartPoint[], height: number): SkPath {
  const builder = Skia.PathBuilder.Make();
  if (points.length > 0) {
    appendSmoothLine(builder, points);
    builder.lineTo(points[points.length - 1].x, height);
    builder.lineTo(points[0].x, height);
    builder.close();
  }
  return builder.detach();
}
