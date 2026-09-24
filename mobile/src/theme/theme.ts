export const theme = {
  colors: {
    // Brand colours — must match frontend/src/variables.css exactly.
    primary: '#1373e5',
    primaryHover: '#0f5fbe',
    positive: '#20b486',
    positiveHover: '#108c63',
    /** Use this wherever the brand colour becomes readable text. */
    primaryText: '#0f4f9c',
    secondary: '#6b3fd6', // MIRA intelligence purple
    accent: '#19a98f', // MIRA resources teal
    utility: '#f28c28', // MIRA automation orange; decorative only
    
    // Backgrounds
    background: '#F9FAFB', // Gray 50
    surface: '#FFFFFF', // White cards/inputs
    
    // Text Colors
    textPrimary: '#111827', // Gray 900
    textSecondary: '#6B7280', // Gray 500
    textMuted: '#9CA3AF', // Gray 400
    
    // Status Colors — two roles per hue, matching the web tokens.
    //
    // The plain value is a FILL: chips, dots, bars, badge backgrounds.
    // The *Text value is for anything that becomes a WORD, where the fills
    // measure only 2.1–3.8:1 against white and cannot be read at body size.
    success: '#19a98f', // MIRA teal
    successText: '#107565',
    danger: '#1373e5', // MIRA blue
    dangerText: '#0f4f9c',
    warning: '#6b3fd6', // MIRA purple
    warningText: '#4f2aa7',
    
    // Borders
    border: '#E5E7EB', // Gray 200
  },
  typography: {
    h1: {
      fontSize: 32,
      fontWeight: '800' as const,
      color: '#111827',
      letterSpacing: -0.5,
    },
    h2: {
      fontSize: 24,
      fontWeight: '700' as const,
      color: '#111827',
    },
    subtitle: {
      fontSize: 16,
      fontWeight: '400' as const,
      color: '#6B7280',
    },
    body: {
      fontSize: 14,
      fontWeight: '400' as const,
      color: '#374151',
    },
    label: {
      fontSize: 14,
      fontWeight: '500' as const,
      color: '#374151',
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: '#FFFFFF',
    }
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  }
};
