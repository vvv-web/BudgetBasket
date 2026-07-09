import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PeopleIcon from '@mui/icons-material/People';
import SchemaIcon from '@mui/icons-material/Schema';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { roleLabels } from '../utils/labels';
import { AppBreadcrumbs } from './AppBreadcrumbs';

const drawerWidth = 280;

const PageActionsContext = createContext<{
  setActions: (node: ReactNode) => void;
} | null>(null);

type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

const ToastContext = createContext<{
  showToast: (message: string, severity?: ToastSeverity) => void;
} | null>(null);

export function usePageChromeActions(actions: ReactNode) {
  const ctx = useContext(PageActionsContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setActions(actions);
    return () => ctx.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actions identity is managed by callers via useMemo
  }, [ctx, actions]);
}

export function useAppToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useAppToast must be used within Layout');
  }
  return ctx.showToast;
}

export function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [actions, setActions] = useState<ReactNode>(null);
  const [toast, setToast] = useState<{ message: string; severity: ToastSeverity; key: number } | null>(null);
  const chrome = useMemo(() => ({ setActions }), []);
  const showToast = useCallback((message: string, severity: ToastSeverity = 'success') => {
    setToast({ message, severity, key: Date.now() });
  }, []);
  const toastCtx = useMemo(() => ({ showToast }), [showToast]);

  useEffect(() => {
    setActions(null);
  }, [location.pathname]);

  const items = [
    { label: 'Сводка', to: '/', icon: <DashboardIcon /> },
    { label: 'Заявки', to: '/requests', icon: <FolderIcon /> },
    ...(user.role === 'admin'
      ? [
          { label: 'Пользователи', to: '/users', icon: <PeopleIcon /> },
          { label: 'Оргструктура', to: '/units', icon: <SchemaIcon /> },
          { label: 'НСИ', to: '/catalogs', icon: <MenuBookIcon /> },
        ]
      : []),
  ];

  return (
    <Box className="app-shell">
      <Drawer className="app-drawer" variant="permanent" sx={{ width: drawerWidth, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}>
        <Toolbar>
          <Stack spacing={1.75} sx={{ width: '100%' }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box className="brand-mark">BB</Box>
              <Box>
                <Typography sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, letterSpacing: '-0.03em' }}>
                  BudgetBasket
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
                  Бюджетирование модулей
                </Typography>
              </Box>
            </Stack>
            <Box sx={{ borderRadius: 3, px: 1.5, py: 1.15, bgcolor: 'rgba(244, 246, 250, 0.9)', border: '1px solid #E5E7EB' }}>
              <Typography variant="body2" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{user.login}</Typography>
              <Typography variant="caption" color="text.secondary">{roleLabels[user.role]}</Typography>
            </Box>
          </Stack>
        </Toolbar>
        <Divider />
        <List>
          {items.map((item) => {
            const selected = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <ListItemButton key={item.to} selected={selected} onClick={() => navigate(item.to)}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            );
          })}
        </List>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ p: 2 }}>
          <Button fullWidth startIcon={<LogoutIcon />} onClick={onLogout} variant="outlined">
            Выйти
          </Button>
        </Box>
      </Drawer>
      <ToastContext.Provider value={toastCtx}>
        <Box component="main" className="app-main">
          <Stack
            className="page-chrome"
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            spacing={2}
          >
            <AppBreadcrumbs />
            {actions ? (
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap className="page-actions">
                {actions}
              </Stack>
            ) : null}
          </Stack>
          <PageActionsContext.Provider value={chrome}>
            <Outlet />
          </PageActionsContext.Provider>
        </Box>
        <Snackbar
          key={toast?.key}
          open={!!toast}
          autoHideDuration={3500}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          onClose={(_, reason) => {
            if (reason === 'clickaway') return;
            setToast(null);
          }}
        >
          {toast ? (
            <Alert onClose={() => setToast(null)} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
              {toast.message}
            </Alert>
          ) : undefined}
        </Snackbar>
      </ToastContext.Provider>
    </Box>
  );
}
