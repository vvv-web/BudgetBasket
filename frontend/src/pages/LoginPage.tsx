import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
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
  const [showPassword, setShowPassword] = useState(false);
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
        <Stack spacing={2.75}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box className="brand-mark">BB</Box>
              <Box>
                <Typography variant="h5">BudgetBasket</Typography>
                <Typography color="text.secondary" variant="body2">
                  Бюджетирование объединений
                </Typography>
              </Box>
            </Stack>
          </Stack>
          <TextField label="Логин" value={login} onChange={(event) => setLogin(event.target.value)} autoFocus fullWidth />
          <TextField
            label="Пароль"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            fullWidth
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowPassword((visible) => !visible)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          <Button type="submit" size="large" variant="contained" startIcon={<LockOutlinedIcon />}>
            Войти в систему
          </Button>
          <Typography variant="caption" color="text.secondary">
            Демо-доступ: admin/admin · economist/economist · employee/employee
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
