import ArchiveIcon from '@mui/icons-material/Archive';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PeopleIcon from '@mui/icons-material/People';
import SchemaIcon from '@mui/icons-material/Schema';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { roleLabels } from '../utils/labels';

const drawerWidth = 268;

export function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const items = [
    { label: 'Сводка', to: '/', icon: <DashboardIcon /> },
    { label: 'Заявки', to: '/requests', icon: <FolderIcon /> },
    { label: 'Архив', to: '/archive', icon: <ArchiveIcon /> },
    ...(user.role === 'admin'
      ? [
          { label: 'Пользователи', to: '/users', icon: <PeopleIcon /> },
          { label: 'Оргструктура', to: '/units', icon: <SchemaIcon /> },
          { label: 'Справочники', to: '/catalogs', icon: <MenuBookIcon /> },
        ]
      : []),
  ];

  return (
    <Box className="app-shell">
      <Drawer className="app-drawer" variant="permanent" sx={{ width: drawerWidth, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}>
        <Toolbar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>BudgetBasket</Typography>
            <Typography variant="body2" color="text.secondary">
              {user.login} · {roleLabels[user.role]}
            </Typography>
          </Box>
        </Toolbar>
        <Divider />
        <List>
          {items.map((item) => (
            <ListItemButton key={item.to} selected={location.pathname === item.to} onClick={() => navigate(item.to)}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ p: 2 }}>
          <Button fullWidth startIcon={<LogoutIcon />} onClick={onLogout} variant="outlined">
            Выйти
          </Button>
        </Box>
      </Drawer>
      <Box component="main" className="app-main">
        <Outlet />
      </Box>
    </Box>
  );
}
