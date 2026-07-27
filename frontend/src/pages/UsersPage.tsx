import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
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
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { TableColumnHeader, TableColumnResizeHandle, TableColumnTools } from '../components/TableColumnControls';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
import type { Role, Unit, User } from '../types';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';
import { roleLabels } from '../utils/labels';
import { filterFieldSx } from '../utils/responsive';
import { EMAIL_RE, PHONE_RE, formatPhone, lettersOnly } from '../utils/validation';

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

const USER_TABLE_COLUMN_WIDTHS: Record<UserTableColumn, number> = {
  actions: 96,
  login: 180,
  role: 170,
  last_name: 180,
  name: 160,
  second_name: 190,
  phone: 180,
  email: 260,
  max_link: 240,
};

const USER_TABLE_COLUMN_MIN_WIDTHS: Record<UserTableColumn, number> = {
  actions: 72,
  login: 120,
  role: 130,
  last_name: 130,
  name: 120,
  second_name: 140,
  phone: 140,
  email: 180,
  max_link: 160,
};

type UserTableColumn =
  | 'actions'
  | 'login'
  | 'role'
  | 'last_name'
  | 'name'
  | 'second_name'
  | 'phone'
  | 'email'
  | 'max_link';

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
  if (detail) return detail;
  if (error instanceof Error && error.message === 'Network Error') return 'Не удалось подключиться к серверу';
  return error instanceof Error ? error.message : fallback;
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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
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
    setForm((current) => ({ ...current, [key]: value }));
  };

  const invalidContact = (form.email && !EMAIL_RE.test(form.email)) || (form.phone && !PHONE_RE.test(form.phone));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} className="profile-dialog">
      <DialogTitle sx={{ pr: 6, pb: 1.5 }}>
        Создать профиль
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        <Stack spacing={0} sx={{ px: 3, py: 2.5 }}>
          <ProfileSection title="Основное">
            <TextField label="Фамилия" value={form.last_name} onChange={(event) => setField('last_name', lettersOnly(event.target.value))} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}>
              <TextField label="Имя" value={form.name} onChange={(event) => setField('name', lettersOnly(event.target.value))} fullWidth autoFocus />
              <TextField label="Отчество" value={form.second_name} onChange={(event) => setField('second_name', lettersOnly(event.target.value))} fullWidth />
            </Stack>
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Контакты">
            <TextField label="Электронная почта" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} error={!!form.email && !EMAIL_RE.test(form.email)} helperText={form.email && !EMAIL_RE.test(form.email) ? 'Введите адрес в формате name@example.ru' : undefined} fullWidth />
            <TextField label="Телефон" value={form.phone} onChange={(event) => setField('phone', formatPhone(event.target.value))} error={!!form.phone && !PHONE_RE.test(form.phone)} helperText={form.phone && !PHONE_RE.test(form.phone) ? 'Формат: +7 (000) 000-00-00' : undefined} fullWidth />
            <TextField label="Ссылка Max" value={form.max_link} onChange={(event) => setField('max_link', event.target.value)} fullWidth placeholder="https://max.ru/..." />
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Доступ">
            <TextField label="Логин" value={form.login} onChange={(event) => setField('login', event.target.value)} fullWidth />
            <TextField label="Пароль" type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} fullWidth />
            <TextField select label="Роль" value={form.role} onChange={(event) => setField('role', event.target.value as Role)} fullWidth>
              {Object.entries(roleLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
          </ProfileSection>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Отмена</Button>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={!form.login || !form.password || !!invalidContact || create.isPending}>
          Создать профиль
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useAppToast();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [form, setForm] = useState<UserDraft>(emptyDraft());

  useEffect(() => {
    if (user) setForm(draftFromUser(user));
  }, [user]);

  const save = useMutation({
    mutationFn: () => api.patch(`/users/${user?.id}`, form),
    onSuccess: () => {
      toast('Изменения пользователя сохранены', 'success');
      onSaved();
      onClose();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить пользователя'), 'error');
    },
  });

  const setField = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const invalidContact = (form.email && !EMAIL_RE.test(form.email)) || (form.phone && !PHONE_RE.test(form.phone));

  return (
    <Dialog open={!!user} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} className="profile-dialog">
      <DialogTitle sx={{ pr: 6, pb: 1.5 }}>
        Редактировать пользователя
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }} aria-label="Закрыть">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        <Stack spacing={0} sx={{ px: 3, py: 2.5 }}>
          <ProfileSection title="Основное">
            <TextField label="Фамилия" value={form.last_name} onChange={(event) => setField('last_name', lettersOnly(event.target.value))} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}>
              <TextField label="Имя" value={form.name} onChange={(event) => setField('name', lettersOnly(event.target.value))} fullWidth autoFocus />
              <TextField label="Отчество" value={form.second_name} onChange={(event) => setField('second_name', lettersOnly(event.target.value))} fullWidth />
            </Stack>
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Контакты">
            <TextField label="Электронная почта" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} error={!!form.email && !EMAIL_RE.test(form.email)} helperText={form.email && !EMAIL_RE.test(form.email) ? 'Введите адрес в формате name@example.ru' : undefined} fullWidth />
            <TextField label="Телефон" value={form.phone} onChange={(event) => setField('phone', formatPhone(event.target.value))} error={!!form.phone && !PHONE_RE.test(form.phone)} helperText={form.phone && !PHONE_RE.test(form.phone) ? 'Формат: +7 (000) 000-00-00' : undefined} fullWidth />
            <TextField label="Ссылка Max" value={form.max_link} onChange={(event) => setField('max_link', event.target.value)} fullWidth placeholder="https://max.ru/..." />
          </ProfileSection>

          <Divider sx={{ my: 2.5 }} />

          <ProfileSection title="Доступ">
            <TextField label="Логин" value={form.login} onChange={(event) => setField('login', event.target.value)} fullWidth />
            <TextField select label="Роль" value={form.role} onChange={(event) => setField('role', event.target.value as Role)} fullWidth>
              {Object.entries(roleLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
          </ProfileSection>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={save.isPending}>Отмена</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={!form.login.trim() || !!invalidContact || save.isPending}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const { data = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [unitFilter, setUnitFilter] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const unitNames = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const filteredUsers = useMemo(
    () => data.filter((user) => (!roleFilter || user.role === roleFilter) && (!unitFilter || user.unit_ids?.includes(unitFilter))),
    [data, roleFilter, unitFilter],
  );

  const tableColumns = useMemo<TableColumnDefinition<User, UserTableColumn>[]>(() => [
    { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
    { id: 'login', label: 'Логин', getValue: (user) => user.login },
    { id: 'role', label: 'Роль', getValue: (user) => roleLabels[user.role] },
    { id: 'last_name', label: 'Фамилия', getValue: (user) => user.profile?.last_name || '—' },
    { id: 'name', label: 'Имя', getValue: (user) => user.profile?.name || '—' },
    { id: 'second_name', label: 'Отчество', getValue: (user) => user.profile?.second_name || '—' },
    { id: 'phone', label: 'Телефон', getValue: (user) => user.profile?.phone || '—' },
    { id: 'email', label: 'Электронная почта', getValue: (user) => user.profile?.email || '—' },
    { id: 'max_link', label: 'Max', getValue: (user) => user.profile?.max_link || '—' },
  ], []);

  const {
    clearColumnFilter,
    clearSort,
    filterOptions,
    filterSearchValues,
    hasActiveFilters,
    resetFilters,
    resetVisibility,
    rows: tableRows,
    selectedFilterValues,
    setAllFilterOptions,
    setFilterSearchValue,
    setSortAscending,
    setSortDescending,
    setVisibleFilterOptions,
    sort,
    toggleFilterOption,
    toggleVisibility,
    visibility,
    visibleColumns,
  } = useTableColumnControls({ rows: filteredUsers, columns: tableColumns });
  const userAutoFitValues = useMemo(() => {
    const values = {} as Record<UserTableColumn, Array<string | number>>;
    tableColumns.forEach((column) => {
      if (column.id === 'actions') {
        values[column.id] = [column.label, 'Удалить'];
        return;
      }
      values[column.id] = [
        column.label,
        ...filteredUsers.map((user) => {
          const value = column.getValue(user);
          return value == null || value === '' ? '—' : String(value);
        }),
      ];
    });
    return values;
  }, [filteredUsers, tableColumns]);
  const { columnWidths, resetColumnWidths, resizeColumn, autoFitColumn } = useTableColumnWidths(
    USER_TABLE_COLUMN_WIDTHS,
    USER_TABLE_COLUMN_MIN_WIDTHS,
    userAutoFitValues,
  );
  const tableWidth = visibleColumns.reduce((sum, column) => sum + columnWidths[column.id], 0);

  const fitUserColumn = (columnId: UserTableColumn) => {
    autoFitColumn(columnId, userAutoFitValues[columnId] || [columnId]);
  };

  const renderHeader = (columnId: UserTableColumn, label: string, options?: { sortable?: boolean; filterable?: boolean }) => (
    <TableColumnHeader
      label={columnId === 'actions' ? 'Действие' : label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={sort?.column === columnId ? sort.direction : null}
      onSortAscending={() => setSortAscending(columnId)}
      onSortDescending={() => setSortDescending(columnId)}
      onClearSort={() => clearSort(columnId)}
      filterOptions={filterOptions[columnId]}
      selectedFilterValues={selectedFilterValues[columnId]}
      filterSearchValue={filterSearchValues[columnId]}
      onFilterSearchChange={(value) => setFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllFilterOptions(columnId)}
      onClearColumnFilter={() => clearColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setVisibleFilterOptions(columnId, false)}
    />
  );

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: (_data, deletedId) => {
      toast('Пользователь удалён', 'success');
      setDeleteTarget(null);
      if (editingUser?.id === deletedId) setEditingUser(null);
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить пользователя'), 'error');
    },
  });

  return (
    <Stack spacing={3}>
      <Paper className="table-surface" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ lg: 'center' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} className="page-filters">
            <TextField select label="Роль" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | '')} sx={filterFieldSx(220)}>
              <MenuItem value="">Все роли</MenuItem>
              {Object.entries(roleLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
            <TextField select label="Объединение" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} sx={filterFieldSx(260)}>
              <MenuItem value="">Все объединения</MenuItem>
              {units.map((unit) => (
                <MenuItem key={unit.id} value={unit.id}>
                  {unit.parent_id ? `${unitNames.get(unit.parent_id) || ''} / ${unit.name}` : unit.name}
                </MenuItem>
              ))}
            </TextField>
            <TableColumnTools
              columns={tableColumns}
              visibility={visibility}
              onToggleColumn={toggleVisibility}
              onResetColumns={resetVisibility}
              onResetFilters={resetFilters}
              onResetWidths={resetColumnWidths}
              hasActiveFilters={hasActiveFilters}
            />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap justifyContent="flex-end">
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
              Добавить пользователя
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <TableContainer component={Paper} className="table-surface">
        <Table size="small" sx={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {visibleColumns.map((column) => <col key={column.id} style={{ width: columnWidths[column.id] }} />)}
          </colgroup>
          <TableHead>
            <TableRow>
              {visibility.actions && <TableCell sx={{ position: 'relative' }}>{renderHeader('actions', 'Действия', { sortable: false, filterable: false })}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('actions', event)} onDoubleClick={() => fitUserColumn('actions')} /></TableCell>}
              {visibility.login && <TableCell sx={{ position: 'relative' }}>{renderHeader('login', 'Логин')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('login', event)} onDoubleClick={() => fitUserColumn('login')} /></TableCell>}
              {visibility.role && <TableCell sx={{ position: 'relative' }}>{renderHeader('role', 'Роль')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('role', event)} onDoubleClick={() => fitUserColumn('role')} /></TableCell>}
              {visibility.last_name && <TableCell sx={{ position: 'relative' }}>{renderHeader('last_name', 'Фамилия')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('last_name', event)} onDoubleClick={() => fitUserColumn('last_name')} /></TableCell>}
              {visibility.name && <TableCell sx={{ position: 'relative' }}>{renderHeader('name', 'Имя')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('name', event)} onDoubleClick={() => fitUserColumn('name')} /></TableCell>}
              {visibility.second_name && <TableCell sx={{ position: 'relative' }}>{renderHeader('second_name', 'Отчество')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('second_name', event)} onDoubleClick={() => fitUserColumn('second_name')} /></TableCell>}
              {visibility.phone && <TableCell sx={{ position: 'relative' }}>{renderHeader('phone', 'Телефон')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('phone', event)} onDoubleClick={() => fitUserColumn('phone')} /></TableCell>}
              {visibility.email && <TableCell sx={{ position: 'relative' }}>{renderHeader('email', 'Электронная почта')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('email', event)} onDoubleClick={() => fitUserColumn('email')} /></TableCell>}
              {visibility.max_link && <TableCell sx={{ position: 'relative' }}>{renderHeader('max_link', 'Max')}<TableColumnResizeHandle onPointerDown={(event) => resizeColumn('max_link', event)} onDoubleClick={() => fitUserColumn('max_link')} /></TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {tableRows.map((user) => (
              <TableRow key={user.id} hover onClick={() => setEditingUser(user)} sx={{ cursor: 'pointer' }}>
                {visibility.actions && (
                  <TableCell sx={{ minWidth: 80 }}>
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(user);
                      }}
                      aria-label="Удалить пользователя"
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
                {visibility.login && <TableCell sx={{ minWidth: 160 }}>{user.login}</TableCell>}
                {visibility.role && <TableCell sx={{ minWidth: 160 }}>{roleLabels[user.role]}</TableCell>}
                {visibility.last_name && <TableCell sx={{ minWidth: 150 }}>{user.profile?.last_name || '—'}</TableCell>}
                {visibility.name && <TableCell sx={{ minWidth: 150 }}>{user.profile?.name || '—'}</TableCell>}
                {visibility.second_name && <TableCell sx={{ minWidth: 170 }}>{user.profile?.second_name || '—'}</TableCell>}
                {visibility.phone && <TableCell sx={{ minWidth: 170 }}>{user.profile?.phone || '—'}</TableCell>}
                {visibility.email && <TableCell sx={{ minWidth: 220 }}>{user.profile?.email || '—'}</TableCell>}
                {visibility.max_link && <TableCell sx={{ minWidth: 240 }}>{user.profile?.max_link || '—'}</TableCell>}
              </TableRow>
            ))}
            {tableRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} align="center">Пользователи не найдены</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateUserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={refresh} />
      <EditUserDialog user={editingUser} onClose={() => setEditingUser(null)} onSaved={refresh} />

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
