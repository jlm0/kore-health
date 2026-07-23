export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  cardGap: 13,
  gridGap: 11,
  lg: 16,
  xl: 20,
  xxl: 24,
  screenX: 20,
} as const;

export const radius = {
  chip: 22,
  sm: 24,
  md: 26,
  lg: 28,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#5A6EA0',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
    shadowOpacity: 0.08,
    elevation: 4,
  },
  circle: {
    shadowColor: '#5A6EA0',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    shadowOpacity: 0.1,
    elevation: 3,
  },
} as const;
