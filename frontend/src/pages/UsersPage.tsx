import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { Role, User } from '../types';
import { roleLabels } from '../utils/labels';

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const [form, setForm] = useState({ login: '', password: '', role: 'employee' as Role });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({ mutationFn: () => api.post('/users', { ...form, is_active: true }), onSuccess: () => { setForm({ login: '', password: '', role: 'employee' }); refresh(); } });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<User> }) => api.patch(`/users/${id}`, body), onSuccess: refresh });

  return (
    <Stack spacing={3}>
      <Typography className="page-title">Пользователи</Typography>
      <Paper className="surface-pad" elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Логин" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          <TextField label="Пароль" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField select label="Роль" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} sx={{ minWidth: 180 }}>
            {Object.entries(roleLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={!form.login || !form.password}>
            Создать
          </Button>
        </Stack>
      </Paper>
      <Paper className="table-surface" elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Логин</TableCell>
              <TableCell>Роль</TableCell>
              <TableCell>ФИО</TableCell>
              <TableCell>Активен</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.login}</TableCell>
                <TableCell>
                  <TextField select size="small" value={user.role} onChange={(e) => patch.mutate({ id: user.id, body: { role: e.target.value as Role } })}>
                    {Object.entries(roleLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell>{[user.profile?.last_name, user.profile?.name, user.profile?.second_name].filter(Boolean).join(' ')}</TableCell>
                <TableCell><Switch checked={user.is_active} onChange={(e) => patch.mutate({ id: user.id, body: { is_active: e.target.checked } })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
