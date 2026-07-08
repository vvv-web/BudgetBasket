import LockIcon from '@mui/icons-material/Lock';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import type { User } from '../types';

export default function LoginPage({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [login, setLogin] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const response = await api.post<{ access_token: string; user: User }>('/auth/login', { login, password });
      onLogin(response.data.access_token, response.data.user);
    } catch {
      setError('Не удалось войти. Проверьте логин и пароль.');
    }
  }

  return (
    <Box className="login-page">
      <Paper component="form" onSubmit={submit} elevation={0} className="login-card">
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>BudgetBasket</Typography>
            <Typography color="text.secondary">Сбор и утверждение бюджетов модулей</Typography>
          </Box>
          <TextField label="Логин" value={login} onChange={(event) => setLogin(event.target.value)} autoFocus />
          <TextField label="Пароль" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <Typography color="error">{error}</Typography>}
          <Button type="submit" size="large" variant="contained" startIcon={<LockIcon />}>
            Войти
          </Button>
          <Typography variant="body2" color="text.secondary">
            Тестовые учетные записи: admin/admin, economist/economist, employee/employee
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
