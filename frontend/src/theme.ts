import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0f766e',
      dark: '#115e59',
      light: '#ccfbf1',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#475569',
      dark: '#334155',
      light: '#e2e8f0',
    },
    background: {
      default: '#f1f5f9',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
    divider: '#e2e8f0',
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: 'Inter, Roboto, Arial, sans-serif',
    h4: {
      fontWeight: 700,
      letterSpacing: 0,
    },
    h5: {
      fontWeight: 700,
      letterSpacing: 0,
    },
    h6: {
      fontWeight: 700,
      letterSpacing: 0,
    },
    button: {
      textTransform: 'none',
      fontWeight: 650,
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 38,
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
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
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#ffffff',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: '#f8fafc',
          color: '#475569',
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        },
        root: {
          borderBottomColor: '#e2e8f0',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 10px',
          '&.Mui-selected': {
            backgroundColor: '#f0fdfa',
            color: '#0f766e',
          },
          '&.Mui-selected:hover': {
            backgroundColor: '#ccfbf1',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 650,
        },
      },
    },
  },
});
