import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import CloseIcon from '@mui/icons-material/Close';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PeopleIcon from '@mui/icons-material/People';
import SchemaIcon from '@mui/icons-material/Schema';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Profile, User } from '../types';
import { roleLabels } from '../utils/labels';
import { EMAIL_RE, PHONE_RE, formatPhone, lettersOnly } from '../utils/validation';
import { AppBreadcrumbs, breadcrumblessPaths } from './AppBreadcrumbs';
import { UserGuideDialog } from './UserGuideDialog';

const expandedDrawerWidth = 280;
const collapsedDrawerWidth = 76;

const PageActionsContext = createContext<{
  setActions: (node: ReactNode) => void;
  setLeading: (node: ReactNode) => void;
} | null>(null);

type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

const ToastContext = createContext<{
  showToast: (message: string, severity?: ToastSeverity) => void;
} | null>(null);

const emptyProfile = {
  name: '',
  second_name: '',
  last_name: '',
  phone: '',
  email: '',
  max_link: '',
};

type ProfileDraft = typeof emptyProfile;

function formatFullName(profile?: Profile | null, fallbackLogin = '') {
  const parts = [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean);
  return parts.join(' ') || fallbackLogin;
}

export function usePageChromeActions(actions: ReactNode) {
  const ctx = useContext(PageActionsContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setActions(actions);
    return () => ctx.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actions identity is managed by callers via useMemo
  }, [ctx, actions]);
}

export function usePageChromeLeading(content: ReactNode) {
  const ctx = useContext(PageActionsContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setLeading(content);
    return () => ctx.setLeading(null);
  }, [ctx, content]);
}

export function useAppToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useAppToast must be used within Layout');
  }
  return ctx.showToast;
}

export function Layout({
  user,
  onLogout,
  onUserChange,
}: {
  user: User;
  onLogout: () => void;
  onUserChange: (nextUser: User) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [actions, setActions] = useState<ReactNode>(null);
  const [leading, setLeading] = useState<ReactNode>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [desktopDrawerCollapsed, setDesktopDrawerCollapsed] = useState(
    () => window.localStorage.getItem('budgetbasket:drawer-collapsed') === 'true',
  );
  const [toast, setToast] = useState<{ message: string; severity: ToastSeverity; key: number } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileDraft>(emptyProfile);
  const showPageChrome = isMobile || !breadcrumblessPaths.has(location.pathname) || !!actions || !!leading;
  const chrome = useMemo(() => ({ setActions, setLeading }), []);
  const showToast = useCallback((message: string, severity: ToastSeverity = 'success') => {
    setToast({ message, severity, key: Date.now() });
  }, []);
  const toastCtx = useMemo(() => ({ showToast }), [showToast]);

  useEffect(() => {
    setActions(null);
    setLeading(null);
  }, [location.pathname]);

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['profile', user.id],
    queryFn: async () => {
      try {
        return (await api.get<Profile>(`/profiles/${user.id}`)).data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  useEffect(() => {
    if (!profile) return;
    if (user.profile && JSON.stringify(user.profile) === JSON.stringify(profile)) return;
    onUserChange({ ...user, profile });
  }, [onUserChange, profile, user]);

  useEffect(() => {
    if (!profileOpen) return;
    const current = profile || user.profile || emptyProfile;
    setProfileForm({
      name: current.name || '',
      second_name: current.second_name || '',
      last_name: current.last_name || '',
      phone: current.phone || '',
      email: current.email || '',
      max_link: current.max_link || '',
    });
  }, [profile, profileOpen, user.profile]);

  const saveProfile = useMutation({
    mutationFn: (body: ProfileDraft) => api.patch<Profile>(`/profiles/${user.id}`, body).then((response) => response.data),
    onSuccess: (nextProfile) => {
      queryClient.setQueryData(['profile', user.id], nextProfile);
      onUserChange({ ...user, profile: nextProfile });
      setProfileOpen(false);
      showToast('Профиль сохранён', 'success');
    },
    onError: (error) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail || (error instanceof Error ? error.message : 'Не удалось сохранить профиль'), 'error');
    },
  });

  const displayName = formatFullName(profile || user.profile || null, user.login);
  const invalidProfileContact =
    (!!profileForm.email && !EMAIL_RE.test(profileForm.email)) ||
    (!!profileForm.phone && !PHONE_RE.test(profileForm.phone));

  const items = [
    ...(user.role !== 'employee' ? [{ label: 'Сводка', to: '/', icon: <DashboardIcon /> }] : []),
    { label: 'Заявки', to: '/requests', icon: <FolderIcon /> },
    ...(user.role === 'admin'
      ? [
          { label: 'Пользователи', to: '/users', icon: <PeopleIcon /> },
          { label: 'Оргструктура', to: '/units', icon: <SchemaIcon /> },
          { label: 'НСИ', to: '/catalogs', icon: <MenuBookIcon /> },
        ]
      : []),
  ];
  const drawerCollapsed = !isMobile && desktopDrawerCollapsed;
  const drawerWidth = drawerCollapsed ? collapsedDrawerWidth : expandedDrawerWidth;

  const toggleDesktopDrawer = () => {
    setDesktopDrawerCollapsed((current) => {
      window.localStorage.setItem('budgetbasket:drawer-collapsed', String(!current));
      return !current;
    });
  };

  return (
    <Box className="app-shell">
      <Drawer
        className={`app-drawer ${drawerCollapsed ? 'app-drawer-collapsed' : ''}`}
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileDrawerOpen : true}
        onClose={() => setMobileDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.standard,
          }),
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.standard,
            }),
          },
        }}
      >
        <Box className="drawer-header">
          <Stack spacing={1.75} sx={{ width: '100%' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" justifyContent={drawerCollapsed ? 'center' : 'space-between'}>
              {!drawerCollapsed && <Box className="brand-mark">BB</Box>}
              {!drawerCollapsed && <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, letterSpacing: '-0.03em' }}>
                  BudgetBasket
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
                  Бюджетирование модулей
                </Typography>
              </Box>}
              <IconButton
                className="system-menu-button"
                aria-label={isMobile ? 'Закрыть меню' : drawerCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
                onClick={isMobile ? () => setMobileDrawerOpen(false) : toggleDesktopDrawer}
                size="small"
              >
                {isMobile || !drawerCollapsed ? <MenuOpenIcon /> : <MenuIcon />}
              </IconButton>
            </Stack>
          </Stack>
        </Box>
        <Divider />
        <List>
          {items.map((item) => {
            const selected = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <Tooltip key={item.to} title={item.label} placement="right" enterDelay={150} disableHoverListener={!drawerCollapsed}>
                <ListItemButton
                  className="drawer-nav-item"
                  selected={selected}
                  onClick={() => {
                    navigate(item.to);
                    setMobileDrawerOpen(false);
                  }}
                >
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  {!drawerCollapsed && <ListItemText primary={item.label} />}
                </ListItemButton>
              </Tooltip>
            );
          })}
        </List>
        <Box className="drawer-footer">
        <Divider />
        <List sx={{ py: 0.5 }}>
          <Tooltip title="Памятка" placement="right" enterDelay={150} disableHoverListener={!drawerCollapsed}>
            <ListItemButton
              dense
              onClick={() => {
                setGuideOpen(true);
                setMobileDrawerOpen(false);
              }}
              aria-label="Открыть памятку пользователя"
            >
              <ListItemIcon>
                <HelpOutlineIcon />
              </ListItemIcon>
              {!drawerCollapsed && <ListItemText primary="Памятка" />}
            </ListItemButton>
          </Tooltip>
          <ListItemButton
            className="drawer-profile-item"
            dense
            onClick={() => {
              setProfileOpen(true);
              setMobileDrawerOpen(false);
            }}
            aria-label="Открыть профиль"
          >
            <ListItemIcon className="drawer-profile-icon">
              <AccountCircleIcon />
            </ListItemIcon>
            {!drawerCollapsed && (
              <ListItemText
                primary={displayName}
                secondary={roleLabels[user.role]}
                primaryTypographyProps={{ sx: { whiteSpace: 'normal', lineHeight: 1.2, overflowWrap: 'anywhere' } }}
                secondaryTypographyProps={{ sx: { whiteSpace: 'normal', lineHeight: 1.1 } }}
              />
            )}
          </ListItemButton>
        </List>
        <Box sx={{ px: 2, pt: 0.5, pb: 1.5 }}>
          <Button
            fullWidth
            startIcon={<LogoutIcon />}
            onClick={() => {
              setMobileDrawerOpen(false);
              onLogout();
            }}
            variant="outlined"
            aria-label="Выйти"
            sx={drawerCollapsed ? { minWidth: 0, px: 0, '& .MuiButton-startIcon': { m: 0 } } : undefined}
          >
            {drawerCollapsed ? null : 'Выйти'}
          </Button>
        </Box>
        </Box>
      </Drawer>

      <UserGuideDialog role={user.role} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} fullWidth maxWidth="sm" className="profile-dialog">
        <DialogTitle sx={{ pr: 6, pb: 1.5 }}>
          Профиль сотрудника
          <IconButton onClick={() => setProfileOpen(false)} sx={{ position: 'absolute', right: 12, top: 12 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers
          sx={{
            p: 0,
            overflowY: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          <Stack spacing={0} sx={{ px: 3, py: 2.5 }}>
            <Box className="profile-form-section">
              <Typography className="profile-form-section-title" sx={{ mb: 1.5 }}>
                Основное
              </Typography>
              <Stack spacing={1.75}>
                <TextField
                  label="Фамилия"
                  value={profileForm.last_name}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, last_name: lettersOnly(event.target.value) }))}
                  fullWidth
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}>
                  <TextField
                    label="Имя"
                    value={profileForm.name}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, name: lettersOnly(event.target.value) }))}
                    fullWidth
                    autoFocus
                  />
                  <TextField
                    label="Отчество"
                    value={profileForm.second_name}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, second_name: lettersOnly(event.target.value) }))}
                    fullWidth
                  />
                </Stack>
              </Stack>
            </Box>

            <Divider sx={{ my: 2.5 }} />

            <Box className="profile-form-section">
              <Typography className="profile-form-section-title" sx={{ mb: 1.5 }}>
                Контакты
              </Typography>
              <Stack spacing={1.75}>
                <TextField
                  label="Email"
                  type="email"
                  value={profileForm.email}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, email: event.target.value }))}
                  error={!!profileForm.email && !EMAIL_RE.test(profileForm.email)}
                  helperText={profileForm.email && !EMAIL_RE.test(profileForm.email) ? 'Введите email в формате name@example.ru' : undefined}
                  fullWidth
                />
                <TextField
                  label="Телефон"
                  value={profileForm.phone}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: formatPhone(event.target.value) }))}
                  error={!!profileForm.phone && !PHONE_RE.test(profileForm.phone)}
                  helperText={profileForm.phone && !PHONE_RE.test(profileForm.phone) ? 'Формат: +7 (000) 000-00-00' : undefined}
                  fullWidth
                />
                <TextField
                  label="Ссылка Max"
                  value={profileForm.max_link}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, max_link: event.target.value }))}
                  fullWidth
                  placeholder="https://max.ru/..."
                />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setProfileOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={() => saveProfile.mutate(profileForm)} disabled={saveProfile.isPending || invalidProfileContact}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <ToastContext.Provider value={toastCtx}>
        <Box component="main" className="app-main">
          {showPageChrome ? (
            <Stack
              className="page-chrome"
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', sm: 'center' }}
              spacing={2}
            >
              <Stack direction="row" spacing={0.75} alignItems="center" minWidth={0}>
                {isMobile ? (
                  <IconButton
                    aria-label="Открыть меню"
                    onClick={() => setMobileDrawerOpen(true)}
                    className="system-menu-button"
                  >
                    <MenuIcon />
                  </IconButton>
                ) : null}
                {leading || <AppBreadcrumbs />}
              </Stack>
              {actions ? (
                <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap className="page-actions">
                  {actions}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
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
