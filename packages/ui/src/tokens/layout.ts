export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  cardGap: 6,
  gridGap: 6,
  screenX: 8,
  card: 24,
  section: 32,
} as const;

export const radius = {
  sm: 10,
  md: 20,
  stat: 24,
  tile: 28,
  lg: 30,
  card: 32,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#2E2A42',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    shadowOpacity: 0.08,
    elevation: 3,
  },
  circle: {
    shadowColor: '#2E2A42',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    shadowOpacity: 0.09,
    elevation: 2,
  },
} as const;
