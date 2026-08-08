export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  cardGap: 10,
  gridGap: 9,
  lg: 16,
  xl: 20,
  xxl: 24,
  screenX: 14,
} as const;

export const radius = {
  chip: 24,
  sm: 26,
  md: 30,
  lg: 34,
  pill: 999,
} as const;

// Glass depth: a soft, neutral, diffuse shadow — cool blue-grey (#5A6EA0)
// reads as a tint on a white theme; a neutral ink shadow keeps the system
// greyscale while the wide radius makes cards float like frosted panes.
export const shadow = {
  card: {
    shadowColor: '#1B2233',
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 28,
    shadowOpacity: 0.09,
    elevation: 5,
  },
  circle: {
    shadowColor: '#1B2233',
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 10,
    shadowOpacity: 0.1,
    elevation: 3,
  },
} as const;
