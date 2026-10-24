/** Design system SnapMarket : toutes les valeurs visuelles sont centralisées ici. */
export const colors = {
  background: '#0B0B12',
  surface: '#171722',
  surfaceRaised: '#20202E',
  border: '#2C2C3D',
  primary: '#7857FF',
  primaryLight: '#A78BFA',
  primaryPressed: '#6545E8',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(11,11,18,0.72)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  small: { fontSize: 11, fontWeight: '600' as const },
} as const;

/** Taille minimale des zones tactiles (accessibilité). */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;
