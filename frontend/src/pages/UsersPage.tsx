import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { usePageChromeActions } from '../components/Layout';
import type { Role, User } from '../types';
import { roleLabels } from '../utils/labels';

const emptyForm = {
  login: '',
  password: '',
  role: 'employee' as Role,
  last_name: '',
  name: '',
  second_name: '',
  phone: '',
  email: '',
  max_link: '',
};

type CreateForm = typeof emptyForm;

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box className="profile-form-section">
      <Typography className="profile-form-section-title" sx={{ mb: 1.5 }}>{title}</Typography>
      <Stack spacing={1.75}>{children}</Stack>
    </Box>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateForm>(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });

  const setField = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" className="profile-dialog">
      <DialogTitle sx={{ pr: 6, pb: 1.5 }}>
        Создать профиль
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
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
          <ProfileSection title="Основное">
            <TextField label="Фамилия" value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}>
              <TextField label="Имя" value={form.name} onChange={(e) => setField('name', e.target.value)} fullWidth autoFocus />
              <TextField label="Отчество" value={form.second_name} onChange={(e) => setField('second_name', e.target.value)} fullWidth />
            </Stack>
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Контакты">
            <TextField label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} fullWidth />
            <TextField label="Телефон" value={form.phone} onChange={(e) => setField('phone', e.target.value)} fullWidth />
            <TextField
              label="Ссылка Max"
              value={form.max_link}
              onChange={(e) => setField('max_link', e.target.value)}
              fullWidth
              placeholder="https://max.ru/..."
            />
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Доступ">
            <TextField label="Логин" value={form.login} onChange={(e) => setField('login', e.target.value)} fullWidth />
            <TextField label="Пароль" type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} fullWidth />
            <TextField select label="Роль" value={form.role} onChange={(e) => setField('role', e.target.value as Role)} fullWidth>
              {Object.entries(roleLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
          </ProfileSection>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => create.mutate()}
          disabled={!form.login || !form.password || create.isPending}
        >
          Создать профиль
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const [dialogOpen, setDialogOpen] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<User> }) => api.patch(`/users/${id}`, body),
    onSuccess: refresh,
  });

  const createButton = useMemo(
    () => (
      <Button key="create-user" startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
        Пользователь
      </Button>
    ),
    [],
  );
  usePageChromeActions(createButton);

  return (
    <Stack spacing={3}>
      <Paper className="table-surface" elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Логин</TableCell>
              <TableCell>Роль</TableCell>
              <TableCell>ФИО</TableCell>
              <TableCell>Телефон</TableCell>
              <TableCell>Email</TableCell>
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
                <TableCell>{[user.profile?.last_name, user.profile?.name, user.profile?.second_name].filter(Boolean).join(' ') || '—'}</TableCell>
                <TableCell>{user.profile?.phone || '—'}</TableCell>
                <TableCell>{user.profile?.email || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <CreateUserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={refresh} />
    </Stack>
  );
}
