import { createTheme } from '@mui/material/styles';

const primary = {
  main: '#2F6FED',
  dark: '#1F56C7',
  light: '#EAF1FF',
  contrastText: '#FFFFFF',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary,
    secondary: {
      main: '#6B7280',
      dark: '#111827',
      light: '#F3F4F6',
    },
    success: {
      main: '#059669',
      light: '#ECFDF5',
    },
    warning: {
      main: '#D97706',
      light: '#FFFBEB',
    },
    error: {
      main: '#DC2626',
      light: '#FEF2F2',
    },
    info: {
      main: '#2563EB',
      light: '#EFF6FF',
    },
    background: {
      default: '#F4F6FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#111827',
      secondary: '#6B7280',
    },
    divider: '#E5E7EB',
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily: '"Plus Jakarta Sans", Inter, "Segoe UI", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.03em' },
    h5: { fontWeight: 700, letterSpacing: '-0.025em' },
    h6: { fontWeight: 650, letterSpacing: '-0.02em' },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F4F6FA',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 12,
          height: 42,
          minHeight: 42,
          minWidth: 132,
          paddingInline: 18,
          whiteSpace: 'nowrap',
          [theme.breakpoints.down('sm')]: {
            minWidth: 0,
            height: 40,
            minHeight: 40,
            paddingInline: 14,
          },
        }),
        sizeSmall: ({ theme }) => ({
          height: 36,
          minHeight: 36,
          minWidth: 96,
          paddingInline: 12,
          borderRadius: 10,
          [theme.breakpoints.down('sm')]: {
            minWidth: 0,
            paddingInline: 10,
          },
        }),
        sizeLarge: ({ theme }) => ({
          height: 46,
          minHeight: 46,
          minWidth: 148,
          paddingInline: 20,
          borderRadius: 12,
          [theme.breakpoints.down('sm')]: {
            minWidth: 0,
            height: 44,
            minHeight: 44,
            paddingInline: 16,
          },
        }),
        containedPrimary: {
          backgroundColor: primary.main,
          color: primary.contrastText,
          boxShadow: '0 1px 2px rgba(17, 24, 39, 0.06)',
          '&:hover': {
            backgroundColor: primary.dark,
            boxShadow: '0 4px 12px rgba(47, 111, 237, 0.22)',
          },
        },
        outlinedPrimary: {
          borderColor: '#D1D5DB',
          color: '#111827',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            borderColor: '#9CA3AF',
            backgroundColor: '#F9FAFB',
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          [theme.breakpoints.down('sm')]: {
            margin: 12,
            width: 'calc(100% - 24px)',
            maxHeight: 'calc(100% - 24px)',
          },
        }),
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: '#F9FAFB',
          color: '#6B7280',
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'none',
          letterSpacing: 0,
        },
        root: {
          borderBottomColor: '#E5E7EB',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          margin: '3px 12px',
          paddingBlock: 10,
          '&.Mui-selected': {
            backgroundColor: primary.light,
            color: '#111827',
          },
          '&.Mui-selected:hover': {
            backgroundColor: '#DFE9FF',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
        },
      },
    },
    MuiTabs: {
      defaultProps: {
        variant: 'scrollable',
        allowScrollButtonsMobile: true,
      },
      styleOverrides: {
        indicator: {
          height: 3,
          borderRadius: 999,
          backgroundColor: primary.main,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 44,
        },
      },
    },
  },
});
