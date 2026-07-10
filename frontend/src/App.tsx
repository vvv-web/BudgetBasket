import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import { Layout } from './components/Layout';
import CatalogsPage from './pages/CatalogsPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RequestDetailsPage from './pages/RequestDetailsPage';
import RequestsPage from './pages/RequestsPage';
import UnitsPage from './pages/UnitsPage';
import UsersPage from './pages/UsersPage';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('budgetbasket_user');
    return raw ? JSON.parse(raw) : null;
  });
  const navigate = useNavigate();

  const persistUser = (nextUser: User) => {
    localStorage.setItem('budgetbasket_user', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  useEffect(() => {
    if (!localStorage.getItem('budgetbasket_token')) return;
    api
      .get<User>('/auth/me')
      .then((response) => persistUser(response.data))
      .catch(() => setUser(null));
  }, []);

  function handleLogin(token: string, nextUser: User) {
    localStorage.setItem('budgetbasket_token', token);
    persistUser(nextUser);
    navigate('/');
  }

  function logout() {
    localStorage.removeItem('budgetbasket_token');
    localStorage.removeItem('budgetbasket_user');
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
      <Route element={<Layout user={user} onLogout={logout} onUserChange={persistUser} />}>
        <Route path="/" element={<DashboardPage user={user} />} />
        <Route path="/requests" element={<RequestsPage user={user} />} />
        <Route path="/requests/:id" element={<RequestDetailsPage user={user} />} />
        <Route path="/users" element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="/units" element={user.role === 'admin' ? <UnitsPage /> : <Navigate to="/" replace />} />
        <Route path="/catalogs" element={user.role === 'admin' ? <CatalogsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
