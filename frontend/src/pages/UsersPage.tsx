import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
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
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast, usePageChromeActions } from '../components/Layout';
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

type UserDraft = {
  login: string;
  role: Role;
  last_name: string;
  name: string;
  second_name: string;
  phone: string;
  email: string;
  max_link: string;
};

const emptyDraft = (): UserDraft => ({
  login: '',
  role: 'employee',
  last_name: '',
  name: '',
  second_name: '',
  phone: '',
  email: '',
  max_link: '',
});

function draftFromUser(user: User): UserDraft {
  return {
    login: user.login,
    role: user.role,
    last_name: user.profile?.last_name || '',
    name: user.profile?.name || '',
    second_name: user.profile?.second_name || '',
    phone: user.profile?.phone || '',
    email: user.profile?.email || '',
    max_link: user.profile?.max_link || '',
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || (error instanceof Error ? error.message : fallback);
}

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
  const toast = useAppToast();
  const [form, setForm] = useState<CreateForm>(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => {
      toast('Пользователь создан', 'success');
      onCreated();
      onClose();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось создать пользователя'), 'error');
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

function UserTableCell({
  editing,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  if (!editing) {
    return <>{value || '—'}</>;
  }
  return <TextField size="small" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} fullWidth />;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const { data = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft());
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const saveUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserDraft }) => api.patch(`/users/${id}`, body),
    onSuccess: () => {
      toast('Изменения пользователя сохранены', 'success');
      setEditingId(null);
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить пользователя'), 'error');
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: (_data, deletedId) => {
      toast('Пользователь удалён', 'success');
      setDeleteTarget(null);
      if (editingId === deletedId) {
        setEditingId(null);
      }
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить пользователя'), 'error');
    },
  });

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setDraft(draftFromUser(user));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };

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
      <TableContainer component={Paper} className="table-surface">
        <Table size="small" sx={{ minWidth: 1200 }}>
          <TableHead>
            <TableRow>
              <TableCell>Логин</TableCell>
              <TableCell>Роль</TableCell>
              <TableCell>Фамилия</TableCell>
              <TableCell>Имя</TableCell>
              <TableCell>Отчество</TableCell>
              <TableCell>Телефон</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Max</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((user) => {
              const editing = editingId === user.id;
              const row = editing ? draft : draftFromUser(user);
              return (
                <TableRow key={user.id} hover>
                  <TableCell sx={{ minWidth: 160 }}>
                    <UserTableCell editing={editing} value={row.login} onChange={(value) => setDraft((prev) => ({ ...prev, login: value }))} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    {editing ? (
                      <TextField
                        select
                        size="small"
                        value={row.role}
                        onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value as Role }))}
                        fullWidth
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <MenuItem key={value} value={value}>{label}</MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      roleLabels[user.role]
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 150 }}>
                    <UserTableCell editing={editing} value={row.last_name} onChange={(value) => setDraft((prev) => ({ ...prev, last_name: value }))} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 150 }}>
                    <UserTableCell editing={editing} value={row.name} onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    <UserTableCell editing={editing} value={row.second_name} onChange={(value) => setDraft((prev) => ({ ...prev, second_name: value }))} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    <UserTableCell editing={editing} value={row.phone} onChange={(value) => setDraft((prev) => ({ ...prev, phone: value }))} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    <UserTableCell editing={editing} value={row.email} onChange={(value) => setDraft((prev) => ({ ...prev, email: value }))} type="email" />
                  </TableCell>
                  <TableCell sx={{ minWidth: 240 }}>
                    <UserTableCell editing={editing} value={row.max_link} onChange={(value) => setDraft((prev) => ({ ...prev, max_link: value }))} placeholder="https://max.ru/..." />
                  </TableCell>
                  <TableCell align="right" sx={{ minWidth: 140 }}>
                    {editing ? (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Сохранить">
                          <span>
                            <IconButton
                              color="primary"
                              onClick={() => saveUser.mutate({ id: user.id, body: draft })}
                              disabled={!draft.login.trim() || saveUser.isPending}
                              aria-label="Сохранить"
                            >
                              <CheckIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Отменить">
                          <span>
                            <IconButton onClick={cancelEdit} disabled={saveUser.isPending} aria-label="Отменить">
                              <CancelIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Редактировать">
                          <span>
                            <IconButton onClick={() => startEdit(user)} aria-label="Редактировать пользователя">
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Удалить">
                          <span>
                            <IconButton onClick={() => setDeleteTarget(user)} aria-label="Удалить пользователя">
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateUserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={refresh} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить пользователя?"
        description={`Пользователь «${deleteTarget?.login || ''}» будет удалён из системы. Это действие нельзя отменить.`}
        pending={deleteUser.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteUser.mutate(deleteTarget.id);
        }}
      />
    </Stack>
  );
}
