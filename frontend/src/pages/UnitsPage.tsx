import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { usePageChromeActions } from '../components/Layout';
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

type UnitDialogMode =
  | { kind: 'create-root' }
  | { kind: 'create-child'; parent: Unit }
  | { kind: 'edit'; unit: Unit };

function fullName(user?: User): string {
  if (!user) return 'не назначен';
  const profile = user.profile;
  const name = [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ');
  return name || user.login;
}

function dedupeUsers(users: User[]): User[] {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function unitKindLabel(unit: Unit): string {
  return unit.parent_id ? 'Модуль' : 'Подразделение';
}

function PersonCard({ user, role, vacancy = false }: { user?: User; role: string; vacancy?: boolean }) {
  return (
    <Box className={`org-person-card ${vacancy ? 'vacancy' : ''}`}>
      <Typography className="org-person-name">{fullName(user)}</Typography>
      <Typography className="org-person-role">{role}</Typography>
    </Box>
  );
}

function UnitFormDialog({
  open,
  mode,
  onClose,
  onSubmit,
  pending,
  employees,
  economists,
  responsibleUserId,
  linkedEconomists,
  onAssignResponsible,
  onAssignEconomist,
  assignPending,
}: {
  open: boolean;
  mode: UnitDialogMode | null;
  onClose: () => void;
  onSubmit: (payload: { name: string; is_active: boolean; parent_id: string | null }) => void;
  pending: boolean;
  employees: User[];
  economists: User[];
  responsibleUserId?: string | null;
  linkedEconomists: User[];
  onAssignResponsible: (userId: string) => void;
  onAssignEconomist: (economistId: string) => void;
  assignPending: boolean;
}) {
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [economistId, setEconomistId] = useState('');

  useEffect(() => {
    if (!open || !mode) return;
    if (mode.kind === 'edit') {
      setName(mode.unit.name);
      setIsActive(mode.unit.is_active);
      setEmployeeId(responsibleUserId || '');
      setEconomistId('');
    } else {
      setName('');
      setIsActive(true);
      setEmployeeId('');
      setEconomistId('');
    }
  }, [open, mode, responsibleUserId]);

  if (!mode) return null;

  const isEdit = mode.kind === 'edit';
  const isRoot = isEdit ? !mode.unit.parent_id : mode.kind === 'create-root';

  const title = isEdit
    ? `Редактировать: ${mode.unit.name}`
    : mode.kind === 'create-child'
      ? `Дочернее объединение для «${mode.parent.name}»`
      : 'Новое подразделение';

  const parentId =
    mode.kind === 'create-child' ? mode.parent.id : mode.kind === 'edit' ? mode.unit.parent_id : null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {mode.kind === 'create-child' && <Alert severity="info">Будет создано объединение внутри выбранного узла.</Alert>}
          {mode.kind === 'create-root' && <Alert severity="info">Корневое подразделение без родителя.</Alert>}

          <TextField label="Название" value={name} onChange={(event) => setName(event.target.value)} fullWidth autoFocus />
          {isEdit && (
            <TextField
              select
              label="Статус"
              value={isActive ? 'active' : 'inactive'}
              onChange={(event) => setIsActive(event.target.value === 'active')}
              fullWidth
            >
              <MenuItem value="active">Активен</MenuItem>
              <MenuItem value="inactive">Неактивен</MenuItem>
            </TextField>
          )}

          {isEdit && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Назначение ответственных</Typography>

              {!isRoot && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                  <TextField
                    select
                    size="small"
                    label="Ответственный сотрудник"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    fullWidth
                  >
                    <MenuItem value="">Не выбран</MenuItem>
                    {employees.map((employee) => (
                      <MenuItem key={employee.id} value={employee.id}>{fullName(employee)}</MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={!employeeId || assignPending}
                    onClick={() => onAssignResponsible(employeeId)}
                    sx={{ minWidth: 140, whiteSpace: 'nowrap' }}
                  >
                    Назначить
                  </Button>
                </Stack>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                <TextField
                  select
                  size="small"
                  label="Экономист"
                  value={economistId}
                  onChange={(event) => setEconomistId(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Не выбран</MenuItem>
                  {economists.map((economist) => (
                    <MenuItem key={economist.id} value={economist.id}>{fullName(economist)}</MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  disabled={!economistId || assignPending}
                  onClick={() => onAssignEconomist(economistId)}
                  sx={{ minWidth: 140, whiteSpace: 'nowrap' }}
                >
                  Закрепить
                </Button>
              </Stack>

              <Box className="org-people-grid in-card">
                {!isRoot && (
                  responsibleUserId
                    ? <PersonCard user={[...employees, ...economists].find((u) => u.id === responsibleUserId)} role="Ответственный сотрудник" />
                    : <PersonCard role="Ответственный сотрудник" vacancy />
                )}
                {linkedEconomists.map((user) => (
                  <PersonCard key={user.id} user={user} role="Экономист" />
                ))}
                {linkedEconomists.length === 0 && <PersonCard role="Экономист" vacancy />}
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || pending}
          onClick={() => onSubmit({ name: name.trim(), is_active: isActive, parent_id: parentId })}
        >
          {isEdit ? 'Сохранить' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OrgUnitCard({
  unit,
  depth,
  users,
  responsible,
  linkedEconomists,
  onCreateChild,
  onEdit,
  children,
}: {
  unit: Unit;
  depth: number;
  users: User[];
  responsible?: Responsible | null;
  linkedEconomists: User[];
  onCreateChild: () => void;
  onEdit: () => void;
  children?: ReactNode;
}) {
  const childCount = unit.children?.length || 0;
  const isRoot = !unit.parent_id;
  const hasChildren = childCount > 0;
  const responsibleUser = users.find((user) => user.id === responsible?.user_id);
  const uniqueEconomists = dedupeUsers(linkedEconomists);

  return (
    <Box className={`org-node ${depth === 0 ? 'org-node-root' : 'org-node-child'} ${hasChildren ? 'has-children' : ''}`}>
      <Box className={`org-unit-card ${isRoot ? 'is-root' : 'is-child'} ${unit.is_active ? '' : 'is-inactive'}`}>
        <Tooltip title="Редактировать">
          <IconButton className="org-edit-btn" size="small" onClick={onEdit} aria-label="Редактировать объединение">
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box sx={{ pr: 4.5 }}>
          <Typography className="org-unit-title">{unit.name}</Typography>
          <Typography className="org-unit-role">{unitKindLabel(unit)}</Typography>
        </Box>

        {unit.is_active && (
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.25 }}>
            <Chip size="small" label="Активен" color="success" />
          </Stack>
        )}

        {!isRoot && (
          <Box className="org-people-grid in-card">
            {responsibleUser ? <PersonCard user={responsibleUser} role="Ответственный сотрудник" /> : <PersonCard role="Ответственный сотрудник" vacancy />}
            {uniqueEconomists.map((user) => (
              <PersonCard key={user.id} user={user} role="Экономист" />
            ))}
            {uniqueEconomists.length === 0 && <PersonCard role="Экономист" vacancy />}
          </Box>
        )}
      </Box>

      <Box className={`org-connector ${hasChildren ? 'with-children' : 'leaf-end'}`}>
        <span className="org-connector-line org-connector-line-top" />
        <Tooltip title="Добавить дочернее объединение">
          <IconButton className="org-add-on-line" size="small" onClick={onCreateChild} aria-label="Добавить дочернее объединение">
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {hasChildren && <span className="org-connector-line org-connector-line-bottom" />}
      </Box>

      {children}
    </Box>
  );
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const { data: tree = [] } = useQuery({
    queryKey: ['units-tree'],
    queryFn: async () => (await api.get<Unit[]>('/units/tree')).data,
  });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data });
  const { data: assignments = [] } = useQuery({
    queryKey: ['assignments'],
    queryFn: async () => (await api.get<Assignment[]>('/economist-assignments')).data,
  });

  const [dialog, setDialog] = useState<UnitDialogMode | null>(null);

  const modules = units.filter((unit) => unit.parent_id);
  const employees = users.filter((user) => user.role === 'employee');
  const economists = users.filter((user) => user.role === 'economist');

  const responsibleQueries = useQueries({
    queries: modules.map((module) => ({
      queryKey: ['responsible', module.id],
      queryFn: async () => (await api.get<Responsible | null>(`/units/${module.id}/responsible`)).data,
    })),
  });

  const responsiblesByUnit = useMemo(() => {
    const result = new Map<string, Responsible | null>();
    modules.forEach((module, index) => result.set(module.id, responsibleQueries[index]?.data ?? null));
    return result;
  }, [modules, responsibleQueries]);

  const economistsByUnit = useMemo(() => {
    const result = new Map<string, User[]>();
    for (const unit of units) {
      const isRoot = !unit.parent_id;
      const matched = assignments
        .filter((item) => item.is_active && item.unit_id === unit.id && item.assignment_type === (isRoot ? 'department' : 'module'))
        .map((item) => users.find((user) => user.id === item.economist_id))
        .filter(Boolean) as User[];
      result.set(unit.id, dedupeUsers(matched));
    }
    for (const unit of units) {
      if (!unit.parent_id) continue;
      const own = result.get(unit.id) || [];
      const parentList = result.get(unit.parent_id) || [];
      result.set(unit.id, dedupeUsers([...parentList, ...own]));
    }
    return result;
  }, [units, assignments, users]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['units'] });
    queryClient.invalidateQueries({ queryKey: ['units-tree'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: ['responsible'] });
  };

  const createUnit = useMutation({
    mutationFn: (payload: { name: string; parent_id: string | null; is_active: boolean }) =>
      api.post('/units', {
        name: payload.name,
        parent_id: payload.parent_id,
        type: payload.parent_id ? 'module' : 'department',
        is_active: payload.is_active,
      }),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; is_active: boolean; parent_id: string | null }) =>
      api.patch(`/units/${id}`, { name: body.name, is_active: body.is_active, parent_id: body.parent_id }),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });

  const responsible = useMutation({
    mutationFn: ({ unitId, userId }: { unitId: string; userId: string }) =>
      api.post(`/units/${unitId}/responsible`, { user_id: userId }),
    onSuccess: refresh,
  });

  const assign = useMutation({
    mutationFn: ({
      unitId,
      economistId,
      assignmentType,
    }: {
      unitId: string;
      economistId: string;
      assignmentType: 'department' | 'module';
    }) =>
      api.post('/economist-assignments', {
        economist_id: economistId,
        unit_id: unitId,
        assignment_type: assignmentType,
        is_active: true,
      }),
    onSuccess: refresh,
  });

  const submitDialog = (payload: { name: string; is_active: boolean; parent_id: string | null }) => {
    if (!dialog) return;
    if (dialog.kind === 'edit') {
      updateUnit.mutate({ id: dialog.unit.id, ...payload });
      return;
    }
    createUnit.mutate(payload);
  };

  const editingUnit = dialog?.kind === 'edit' ? dialog.unit : null;

  const addRootButton = useMemo(
    () => (
      <Button key="add-root" startIcon={<AddIcon />} variant="contained" onClick={() => setDialog({ kind: 'create-root' })}>
        Подразделение
      </Button>
    ),
    [],
  );
  usePageChromeActions(addRootButton);

  const renderNode = (unit: Unit, depth: number): ReactNode => {
    const children = unit.children || [];
    return (
      <OrgUnitCard
        key={unit.id}
        unit={unit}
        depth={depth}
        users={users}
        responsible={responsiblesByUnit.get(unit.id)}
        linkedEconomists={economistsByUnit.get(unit.id) || []}
        onCreateChild={() => setDialog({ kind: 'create-child', parent: unit })}
        onEdit={() => setDialog({ kind: 'edit', unit })}
      >
        {children.length > 0 ? (
          <Box className="org-branches" data-count={children.length}>
            {children.map((child) => renderNode(child, depth + 1))}
          </Box>
        ) : null}
      </OrgUnitCard>
    );
  };

  return (
    <Stack spacing={3}>
      <Paper className="org-chart-panel" elevation={0}>
        {tree.length > 0 ? (
          <Box className="org-forest">
            {tree.map((root) => (
              <Box key={root.id} className="org-chart">
                {renderNode(root, 0)}
              </Box>
            ))}
          </Box>
        ) : (
          <Stack spacing={2} alignItems="flex-start">
            <Typography color="text.secondary">Пока нет объединений. Создайте корневое подразделение.</Typography>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialog({ kind: 'create-root' })}>
              Создать подразделение
            </Button>
          </Stack>
        )}
      </Paper>

      <UnitFormDialog
        open={!!dialog}
        mode={dialog}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
        pending={createUnit.isPending || updateUnit.isPending}
        employees={employees}
        economists={economists}
        responsibleUserId={editingUnit ? responsiblesByUnit.get(editingUnit.id)?.user_id : null}
        linkedEconomists={editingUnit ? economistsByUnit.get(editingUnit.id) || [] : []}
        onAssignResponsible={(userId) => {
          if (!editingUnit) return;
          responsible.mutate({ unitId: editingUnit.id, userId });
        }}
        onAssignEconomist={(economistId) => {
          if (!editingUnit) return;
          assign.mutate({
            unitId: editingUnit.id,
            economistId,
            assignmentType: editingUnit.parent_id ? 'module' : 'department',
          });
        }}
        assignPending={responsible.isPending || assign.isPending}
      />
    </Stack>
  );
}
