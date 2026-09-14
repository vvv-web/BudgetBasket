import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api/client';
import { Layout } from './components/Layout';
import { PageSkeleton } from './components/PageSkeleton';
import LoginPage from './pages/LoginPage';
import type { User } from './types';
import { canAccessApproval, defaultRouteForRole } from './utils/roles';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, clearUserSession } from './utils/session';

const ApprovalPage = lazy(() => import('./pages/ApprovalPage'));
const CatalogsPage = lazy(() => import('./pages/CatalogsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const RequestDetailsPage = lazy(() => import('./pages/RequestDetailsPage'));
const RequestsPage = lazy(() => import('./pages/RequestsPage'));
const UnitsPage = lazy(() => import('./pages/UnitsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const FilePreviewDialog = lazy(() => import('./components/FilePreviewDialog').then((module) => ({
  default: module.FilePreviewDialog,
})));

function PageLoadBoundary({ children, variant = 'table', label }: {
  children: ReactNode;
  variant?: 'table' | 'dashboard' | 'details';
  label: string;
}) {
  return <Suspense fallback={<PageSkeleton variant={variant} label={label} />}>{children}</Suspense>;
}

function RequestDetailsRoute({ user }: { user: User }) {
  const { id = '' } = useParams();
  // Remount on :id change so dialogs, chat drafts and local UI never leak between requests.
  return <RequestDetailsPage key={id} user={user} />;
}

function FilePreviewRoute() {
  const { fileId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/" replace />;

  return (
    <FilePreviewDialog
      file={{ id, id_storage_object: 0, original_name: searchParams.get('name') || `Файл ${id}` }}
      open
      fullScreen
      showOpenInNewWindow={false}
      onClose={() => window.close()}
    />
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const navigate = useNavigate();

  const persistUser = (nextUser: User) => {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  };

  useEffect(() => {
    if (!localStorage.getItem(AUTH_TOKEN_KEY)) return;
    api
      .get<User>('/auth/me')
      .then((response) => persistUser(response.data))
      .catch(() => {
        clearUserSession();
        setUser(null);
      });
  }, []);

  function handleLogin(token: string, nextUser: User) {
    // Drop any prior-user query cache / chat prefs before entering the new session.
    clearUserSession();
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    persistUser(nextUser);
    navigate(defaultRouteForRole(nextUser.role));
  }

  function logout() {
    clearUserSession();
    setUser(null);
    navigate('/login');
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/file-preview/:fileId" element={<PageLoadBoundary variant="details" label="Загрузка файла"><FilePreviewRoute /></PageLoadBoundary>} />
      <Route element={<Layout user={user} onLogout={logout} onUserChange={persistUser} />}>
        <Route path="/" element={user.role === 'employee' || user.role === 'economist' ? <Navigate to="/requests" replace /> : <PageLoadBoundary variant="dashboard" label="Загрузка сводки бюджета"><DashboardPage user={user} /></PageLoadBoundary>} />
        <Route path="/income-dashboard" element={<Navigate to="/" replace />} />
        <Route path="/requests" element={<PageLoadBoundary label="Загрузка заявок"><RequestsPage user={user} /></PageLoadBoundary>} />
        <Route path="/register" element={<Navigate to="/requests" replace />} />
        <Route path="/requests/:id" element={<PageLoadBoundary variant="details" label="Загрузка заявки"><RequestDetailsRoute user={user} /></PageLoadBoundary>} />
        <Route path="/users" element={user.role === 'admin' ? <PageLoadBoundary label="Загрузка пользователей"><UsersPage /></PageLoadBoundary> : <Navigate to="/" replace />} />
        <Route path="/units" element={user.role === 'admin' ? <PageLoadBoundary label="Загрузка оргструктуры"><UnitsPage /></PageLoadBoundary> : <Navigate to="/" replace />} />
        <Route path="/catalogs" element={user.role === 'admin' || user.role === 'economist' ? <PageLoadBoundary label="Загрузка справочников"><CatalogsPage user={user} /></PageLoadBoundary> : <Navigate to="/" replace />} />
        <Route path="/approval" element={canAccessApproval(user.role) ? <PageLoadBoundary label="Загрузка согласования"><ApprovalPage key={user.id} user={user} /></PageLoadBoundary> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
