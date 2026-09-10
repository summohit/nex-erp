export const theme = {
  colors: {
    // Brand Colors — must match frontend/src/variables.css exactly. These used
    // to be #FF5722/#E64A19, a slightly different orange from the web's, which
    // read as a rendering fault when the two were seen side by side.
    primary: '#FF5200',
    primaryHover: '#E64A00',
    /** Brand orange is 3.25:1 on white — use this wherever it becomes text. */
    primaryText: '#C2410C',
    
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
    success: '#10B981', // Emerald 500
    successText: '#047857', // 5.48:1 on white
    danger: '#EF4444', // Red 500
    dangerText: '#B91C1C', // 6.47:1 on white
    warning: '#F59E0B', // Amber 500
    warningText: '#B45309', // 5.02:1 on white
    
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
