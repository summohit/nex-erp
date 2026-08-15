export const theme = {
  colors: {
    // Brand Colors
    primary: '#FF5722', // Vibrant Orange (used in Web CRM)
    primaryHover: '#E64A19', // Darker Orange
    
    // Backgrounds
    background: '#F9FAFB', // Gray 50
    surface: '#FFFFFF', // White cards/inputs
    
    // Text Colors
    textPrimary: '#111827', // Gray 900
    textSecondary: '#6B7280', // Gray 500
    textMuted: '#9CA3AF', // Gray 400
    
    // Status Colors
    success: '#10B981', // Emerald 500
    danger: '#EF4444', // Red 500
    warning: '#F59E0B', // Amber 500
    
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
