import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Unit, User } from '../types';

interface Responsible {
  unit_id: string;
  user_id: string;
  is_active: boolean;
}

interface Assignment {
  id: string;
  economist_id: string;
  unit_id: string;
  assignment_type: 'department' | 'module';
  is_active: boolean;
}

function fullName(user?: User): string {
  if (!user) return 'Вакансия';
  const profile = user.profile;
  const name = [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ');
  return name || user.login;
}

function dedupeUsers(users: User[]): User[] {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function PersonCard({ user, role, vacancy = false }: { user?: User; role: string; vacancy?: boolean }) {
  return (
    <Box className={`org-person-card ${vacancy ? 'vacancy' : ''}`}>
      <Typography className="org-person-name">{fullName(user)}</Typography>
      <Typography className="org-person-role">{role}</Typography>
    </Box>
  );
}

function ModuleBranch({
  module,
  responsible,
  users,
  economists,
  employees,
  allEconomists,
  onResponsible,
  onEconomist,
}: {
  module: Unit;
  responsible?: Responsible | null;
  users: User[];
  economists: User[];
  employees: User[];
  allEconomists: User[];
  onResponsible: (unitId: string, userId: string) => void;
  onEconomist: (unitId: string, economistId: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [economistId, setEconomistId] = useState('');
  const responsibleUser = users.find((user) => user.id === responsible?.user_id);
  const uniqueEconomists = dedupeUsers(economists).filter((user) => user.id !== responsibleUser?.id);

  return (
    <Box className="org-branch">
      <Box className="org-module-card">
        <Typography className="org-module-title">{module.name}</Typography>
        <Typography className="org-module-subtitle">Модуль</Typography>
        <Typography className="org-module-responsible">
          Ответственный: <b>{responsibleUser ? fullName(responsibleUser) : 'не назначен'}</b>
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 0.75 }}>
          <Chip size="small" label={responsibleUser ? 'Ответственный назначен' : 'Вакансия'} color={responsibleUser ? 'success' : 'error'} />
          <Chip size="small" label={`${uniqueEconomists.length} экон.`} variant="outlined" />
        </Stack>
        <Stack spacing={1} className="org-card-actions">
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Ответственный" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} fullWidth>
              {employees.map((employee) => (
                <MenuItem key={employee.id} value={employee.id}>{fullName(employee)}</MenuItem>
              ))}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => onResponsible(module.id, employeeId)} disabled={!employeeId}>
              Назначить
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Экономист" value={economistId} onChange={(event) => setEconomistId(event.target.value)} fullWidth>
              {allEconomists.map((economist) => (
                <MenuItem key={economist.id} value={economist.id}>{fullName(economist)}</MenuItem>
              ))}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => onEconomist(module.id, economistId)} disabled={!economistId}>
              Закрепить
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Box className="org-people-grid">
        {responsibleUser ? <PersonCard user={responsibleUser} role="Ответственный сотрудник" /> : <PersonCard role="Ответственный сотрудник" vacancy />}
        {uniqueEconomists.map((user) => (
          <PersonCard key={user.id} user={user} role="Экономист модуля" />
        ))}
        {uniqueEconomists.length === 0 && <PersonCard role="Экономист модуля" vacancy />}
      </Box>
    </Box>
  );
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const { data: assignments = [] } = useQuery({ queryKey: ['assignments'], queryFn: async () => (await api.get<Assignment[]>('/economist-assignments')).data });
  const [form, setForm] = useState({ name: '', type: 'module', parent_id: '' });
  const [departmentEconomistId, setDepartmentEconomistId] = useState('');

  const modules = units.filter((unit) => unit.type === 'module');
  const departments = units.filter((unit) => unit.type === 'department');
  const employees = users.filter((user) => user.role === 'employee');
  const economists = users.filter((user) => user.role === 'economist');
  const selectedDepartment = departments[0];
  const departmentModules = selectedDepartment ? modules.filter((unit) => unit.parent_id === selectedDepartment.id) : modules;

  const responsibleQueries = useQueries({
    queries: departmentModules.map((module) => ({
      queryKey: ['responsible', module.id],
      queryFn: async () => (await api.get<Responsible | null>(`/units/${module.id}/responsible`)).data,
    })),
  });

  const responsiblesByUnit = useMemo(() => {
    const result = new Map<string, Responsible | null>();
    departmentModules.forEach((module, index) => result.set(module.id, responsibleQueries[index]?.data ?? null));
    return result;
  }, [departmentModules, responsibleQueries]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['units'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: ['responsible'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/units', { ...form, parent_id: form.parent_id || selectedDepartment?.id || null, is_active: true }),
    onSuccess: () => {
      setForm({ name: '', type: 'module', parent_id: selectedDepartment?.id || '' });
      refresh();
    },
  });
  const responsible = useMutation({
    mutationFn: ({ unitId, userId }: { unitId: string; userId: string }) => api.post(`/units/${unitId}/responsible`, { user_id: userId }),
    onSuccess: refresh,
  });
  const assign = useMutation({
    mutationFn: ({ unitId, economistId, assignmentType }: { unitId: string; economistId: string; assignmentType: 'department' | 'module' }) =>
      api.post('/economist-assignments', { economist_id: economistId, unit_id: unitId, assignment_type: assignmentType, is_active: true }),
    onSuccess: refresh,
  });

  const departmentEconomists = dedupeUsers(
    assignments
      .filter((item) => item.is_active && item.assignment_type === 'department' && item.unit_id === selectedDepartment?.id)
      .map((item) => users.find((user) => user.id === item.economist_id))
      .filter(Boolean) as User[],
  );

  const economistsByModule = (moduleId: string) =>
    dedupeUsers(
      assignments
        .filter((item) => item.is_active && item.assignment_type === 'module' && item.unit_id === moduleId)
        .map((item) => users.find((user) => user.id === item.economist_id))
        .filter(Boolean) as User[],
    );

  return (
    <Stack spacing={3}>
      <Typography className="page-title">Оргструктура</Typography>

      <Paper className="org-chart-panel" elevation={0}>
        {selectedDepartment ? (
          <Box className="org-chart">
            <Box className="org-root-card">
              <Typography className="org-root-title">{selectedDepartment.name}</Typography>
              <Typography className="org-root-role">Подразделение</Typography>
              <Typography className="org-root-muted">Модули: {departmentModules.length}</Typography>
              <Stack direction="row" spacing={0.75} className="org-root-stats">
                <Chip size="small" label={`${departmentModules.length} мод.`} color="info" />
                <Chip size="small" label={`${departmentEconomists.length} экон.`} color="secondary" variant="outlined" />
              </Stack>
              <Stack spacing={1} className="org-card-actions">
                <Stack direction="row" spacing={1}>
                  <TextField select size="small" label="Экономист" value={departmentEconomistId} onChange={(event) => setDepartmentEconomistId(event.target.value)} fullWidth>
                    {economists.map((economist) => (
                      <MenuItem key={economist.id} value={economist.id}>{fullName(economist)}</MenuItem>
                    ))}
                  </TextField>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => assign.mutate({ unitId: selectedDepartment.id, economistId: departmentEconomistId, assignmentType: 'department' })}
                    disabled={!departmentEconomistId}
                  >
                    Закрепить
                  </Button>
                </Stack>
              </Stack>
            </Box>
            <Box className="org-branches">
              {departmentModules.map((module) => (
                <ModuleBranch
                  key={module.id}
                  module={module}
                  responsible={responsiblesByUnit.get(module.id)}
                  users={users}
                  employees={employees}
                  allEconomists={economists}
                  economists={[...departmentEconomists, ...economistsByModule(module.id)]}
                  onResponsible={(unitId, userId) => responsible.mutate({ unitId, userId })}
                  onEconomist={(unitId, economistId) => assign.mutate({ unitId, economistId, assignmentType: 'module' })}
                />
              ))}
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary">Создайте подразделение, чтобы построить схему.</Typography>
        )}
      </Paper>

      <Paper className="surface-pad" elevation={0}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Создание подразделений и модулей</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Название" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <TextField select label="Тип" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} sx={{ minWidth: 180 }}>
            <MenuItem value="department">Подразделение</MenuItem>
            <MenuItem value="module">Модуль</MenuItem>
          </TextField>
          <TextField select label="Родитель" value={form.parent_id} onChange={(event) => setForm({ ...form, parent_id: event.target.value })} sx={{ minWidth: 260 }}>
            <MenuItem value="">Нет</MenuItem>
            {departments.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
          </TextField>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={!form.name}>Создать</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
