import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api/client';
import { FilePreviewDialog } from './components/FilePreviewDialog';
import { Layout } from './components/Layout';
import CatalogsPage from './pages/CatalogsPage';
import ApprovalPage from './pages/ApprovalPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RequestDetailsPage from './pages/RequestDetailsPage';
import RequestsPage from './pages/RequestsPage';
import UnitsPage from './pages/UnitsPage';
import UsersPage from './pages/UsersPage';
import type { User } from './types';
import { canAccessApproval, defaultRouteForRole } from './utils/roles';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, clearUserSession } from './utils/session';

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
      <Route path="/file-preview/:fileId" element={<FilePreviewRoute />} />
      <Route element={<Layout user={user} onLogout={logout} onUserChange={persistUser} />}>
        <Route path="/" element={user.role === 'employee' ? <Navigate to="/requests" replace /> : <DashboardPage user={user} />} />
        <Route path="/income-dashboard" element={<Navigate to="/" replace />} />
        <Route path="/requests" element={<RequestsPage user={user} />} />
        <Route path="/requests/:id" element={<RequestDetailsRoute user={user} />} />
        <Route path="/users" element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="/units" element={user.role === 'admin' ? <UnitsPage /> : <Navigate to="/" replace />} />
        <Route path="/catalogs" element={user.role === 'admin' ? <CatalogsPage /> : <Navigate to="/" replace />} />
        <Route path="/approval" element={canAccessApproval(user.role) ? <ApprovalPage key={user.id} user={user} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
