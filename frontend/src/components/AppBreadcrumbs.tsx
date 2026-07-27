import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useLocation } from 'react-router-dom';

const labels: Record<string, string> = {
  '': 'Сводка по бюджетам',
  requests: 'Заявки',
  users: 'Пользователи',
  units: 'Оргструктура',
  catalogs: 'НСИ',
  approval: 'Маршрут согласования',
};

export const breadcrumblessPaths = new Set(['/', '/users', '/catalogs', '/approval']);

const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Crumb = { label: string; to?: string };

function buildCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return [{ label: labels[''] }];
  }

  const crumbs: Crumb[] = [];
  let path = '';
  parts.forEach((part, index) => {
    path += `/${part}`;
    const isLast = index === parts.length - 1;
    const isRequestId = parts[0] === 'requests' && index === 1 && uuidLike.test(part);
    crumbs.push({
      label: isRequestId ? `Заявка ${part.slice(0, 8)}` : labels[part] || part,
      to: isLast ? undefined : path,
    });
  });
  return crumbs;
}

export function AppBreadcrumbs() {
  const location = useLocation();

  if (breadcrumblessPaths.has(location.pathname)) {
    return null;
  }

  const crumbs = buildCrumbs(location.pathname);

  return (
    <Breadcrumbs className="app-breadcrumbs" separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        if (last || !crumb.to) {
          return (
            <Typography key={`${crumb.label}-${index}`} className="page-title" component="h1">
              {crumb.label}
            </Typography>
          );
        }
        return (
          <Link
            key={`${crumb.label}-${index}`}
            component={RouterLink}
            underline="hover"
            color="inherit"
            to={crumb.to}
            sx={{ fontWeight: 550, fontSize: '0.95rem' }}
          >
            {crumb.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
