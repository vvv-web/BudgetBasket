import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
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
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePageChromeActions, usePageChromeLeading } from '../components/Layout';
import { useAppToast } from '../components/Layout';
import type { Unit, User } from '../types';
import { money } from '../utils/labels';

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
  | { kind: 'create-child'; parent: Unit; level: number }
  | { kind: 'edit'; unit: Unit; level: number };

function unitLevel(unitId: string, units: Unit[]): number {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  let level = 1;
  let current = byId.get(unitId);
  const visited = new Set<string>();
  while (current?.parent_id && !visited.has(current.id)) {
    visited.add(current.id);
    level += 1;
    current = byId.get(current.parent_id);
  }
  return level;
}

function fullName(user?: User): string {
  if (!user) return 'не назначен';
  const profile = user.profile;
  const name = [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ');
  return name || user.login;
}

function dedupeUsers(users: User[]): User[] {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  if (detail) return detail;
  if (error instanceof Error && error.message === 'Network Error') return 'Не удалось подключиться к серверу';
  return detail || (error instanceof Error ? error.message : fallback);
}

function PersonCard({ user, role, vacancy = false }: { user?: User; role: string; vacancy?: boolean }) {
  return (
    <Box className={`org-person-card ${vacancy ? 'vacancy' : ''}`}>
      <Typography className="org-person-name">{fullName(user)}</Typography>
      <Typography className="org-person-role">{role}</Typography>
    </Box>
  );
}

function UserAutocomplete({
  users,
  value,
  label,
  required = false,
  size,
  onChange,
}: {
  users: User[];
  value: string;
  label: string;
  required?: boolean;
  size?: 'small' | 'medium';
  onChange: (userId: string) => void;
}) {
  const unassigned: User = { id: '', login: 'Не назначен', role: 'employee' };
  const options = [unassigned, ...users];
  return (
    <Autocomplete
      fullWidth
      sx={{ flex: 1, minWidth: 0 }}
      options={options}
      value={users.find((user) => user.id === value) || unassigned}
      getOptionLabel={fullName}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      noOptionsText="Пользователи не найдены"
      onChange={(_, user) => onChange(user?.id || '')}
      renderInput={(params) => <TextField {...params} required={required} label={label} size={size} />}
    />
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
  onUnassignResponsible,
  onAssignEconomist,
  onUnassignEconomist,
  assignPending,
  onDelete,
  deletePending = false,
}: {
  open: boolean;
  mode: UnitDialogMode | null;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    is_active: boolean;
    parent_id: string | null;
    uses_invest_projects: boolean;
    responsible_user_id?: string;
    economist_id?: string;
  }) => void;
  pending: boolean;
  employees: User[];
  economists: User[];
  responsibleUserId?: string | null;
  linkedEconomists: User[];
  onAssignResponsible: (userId: string) => void;
  onUnassignResponsible: () => void;
  onAssignEconomist: (economistId: string, unitId: string) => void;
  onUnassignEconomist: (economistId: string) => void;
  assignPending: boolean;
  onDelete?: () => void;
  deletePending?: boolean;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [usesInvestProjects, setUsesInvestProjects] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [economistId, setEconomistId] = useState('');

  useEffect(() => {
    if (!open || !mode) return;
    if (mode.kind === 'edit') {
      setName(mode.unit.name);
      setIsActive(mode.unit.is_active);
      setUsesInvestProjects(mode.unit.uses_invest_projects);
      setEmployeeId(responsibleUserId || '');
      setEconomistId(linkedEconomists[0]?.id || '');
    } else {
      setName('');
      setIsActive(true);
      setUsesInvestProjects(false);
      setEmployeeId('');
      setEconomistId('');
    }
  }, [open, mode, responsibleUserId, linkedEconomists]);

  if (!mode) return null;

  const isEdit = mode.kind === 'edit';
  const level = mode.kind === 'create-root' ? 1 : mode.level;
  const canAssign = level === 3;

  const title = isEdit
    ? `Редактировать: ${mode.unit.name}`
    : mode.kind === 'create-child'
    ? `Новое объединение внутри «${mode.parent.name}»`
      : 'Новое объединение';

  const parentId =
    mode.kind === 'create-child' ? mode.parent.id : mode.kind === 'edit' ? mode.unit.parent_id : null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} scroll="paper">
      <DialogTitle sx={{ pr: isEdit && onDelete ? 7 : undefined }}>
        {title}
        {isEdit && onDelete && (
          <Tooltip title="Удалить объединение">
            <IconButton
              color="error"
              onClick={onDelete}
              disabled={pending || deletePending}
              sx={{ position: 'absolute', top: 18, right: 18 }}
              aria-label="Удалить объединение"
            >
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {mode.kind === 'create-child' && <Alert severity="info">Будет создано объединение внутри выбранного объединения.</Alert>}
          {mode.kind === 'create-root' && <Alert severity="info">Объединение верхнего уровня без родителя.</Alert>}

          <TextField label="Название" value={name} onChange={(event) => setName(event.target.value)} fullWidth autoFocus />
          <Alert severity="info">Годовой бюджет рассчитывается автоматически из одобренных строк закрытых заявок.</Alert>
          <TextField select label="Тип строк заявки" value={usesInvestProjects ? 'invest' : 'dds'} onChange={(event) => setUsesInvestProjects(event.target.value === 'invest')} fullWidth>
            <MenuItem value="dds">Статьи ДДС</MenuItem>
            <MenuItem value="invest">Инвестиционные проекты</MenuItem>
          </TextField>
          {mode.kind === 'create-child' && canAssign && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Ответственные объединения</Typography>
              <UserAutocomplete users={employees} value={employeeId} label="Сотрудник" onChange={setEmployeeId} />
            </>
          )}

          {mode.kind !== 'edit' && canAssign && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Назначение экономиста</Typography>
              <UserAutocomplete
                users={economists}
                value={economistId}
                label="Экономист"
                onChange={setEconomistId}
              />
            </>
          )}

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

          {isEdit && canAssign && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Назначение ответственных</Typography>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                  <UserAutocomplete users={employees} value={employeeId} label="Ответственный сотрудник" size="small" onChange={setEmployeeId} />
                  <Tooltip title={employeeId ? 'Сохранить назначение' : 'Снять ответственного'}>
                    <Button
                      variant="outlined"
                      disabled={assignPending || (!employeeId && !responsibleUserId)}
                      onClick={() => employeeId ? onAssignResponsible(employeeId) : onUnassignResponsible()}
                      aria-label={employeeId ? 'Сохранить назначение' : 'Снять ответственного'}
                      sx={{ minWidth: 44, width: 44, px: 0 }}
                    >
                      {employeeId ? <SaveOutlinedIcon fontSize="small" /> : <PersonRemoveOutlinedIcon fontSize="small" />}
                    </Button>
                  </Tooltip>
                </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                <UserAutocomplete users={economists} value={economistId} label="Экономист" size="small" onChange={setEconomistId} />
                <Tooltip title={economistId ? 'Сохранить назначение' : 'Снять экономиста'}>
                  <Button
                    variant="outlined"
                    disabled={assignPending || (!economistId && linkedEconomists.length === 0)}
                    onClick={() => economistId
                      ? onAssignEconomist(economistId, mode.kind === 'edit' ? mode.unit.id : '')
                      : onUnassignEconomist(linkedEconomists[0].id)}
                    aria-label={economistId ? 'Сохранить назначение' : 'Снять экономиста'}
                    sx={{ minWidth: 44, width: 44, px: 0 }}
                  >
                    {economistId ? <SaveOutlinedIcon fontSize="small" /> : <PersonRemoveOutlinedIcon fontSize="small" />}
                  </Button>
                </Tooltip>
              </Stack>

            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || pending}
          onClick={() => onSubmit({
            name: name.trim(),
            is_active: isActive,
            parent_id: parentId,
            uses_invest_projects: usesInvestProjects,
            responsible_user_id: mode.kind === 'create-child' && canAssign ? employeeId || undefined : undefined,
            economist_id: mode.kind !== 'edit' && canAssign ? economistId || undefined : undefined,
          })}
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
  const isAssignmentLevel = depth === 2;
  const canCreateChild = depth < 2;
  const hasChildren = childCount > 0;
  const responsibleUser = users.find((user) => user.id === responsible?.user_id);
  const uniqueEconomists = dedupeUsers(linkedEconomists);
  const missingResponsible = isAssignmentLevel && !responsibleUser;
  const missingEconomists = isAssignmentLevel && uniqueEconomists.length === 0;
  const hasMissingAssignments = missingResponsible || missingEconomists;
  const [peopleExpanded, setPeopleExpanded] = useState(false);
  const peopleCount = (responsibleUser ? 1 : 0) + uniqueEconomists.length;

  return (
    <Box data-depth={depth} className={`org-node ${depth === 0 ? 'org-node-root' : 'org-node-child'} ${hasChildren ? 'has-children' : ''}`}>
      <Box className={`org-unit-card ${isRoot ? 'is-root' : 'is-child'} ${unit.is_active ? '' : 'is-inactive'} ${hasMissingAssignments ? 'needs-attention' : ''}`}>
        <Tooltip title="Редактировать">
        <IconButton className="org-edit-btn" size="small" onClick={onEdit} aria-label="Редактировать объединение">
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box className="org-unit-heading">
          <Typography className="org-unit-title">{unit.name}</Typography>
        </Box>

        <Stack direction="row" spacing={0.75} className="org-unit-status">
          <Chip size="small" label={unit.is_active ? 'Активен' : 'Неактивен'} color={unit.is_active ? 'success' : 'default'} variant={unit.is_active ? 'filled' : 'outlined'} />
        </Stack>

        {isAssignmentLevel && <Box className="org-people-section">
          <Box className="org-card-meta">
            <Tooltip title={`Годовой бюджет: ${money(unit.annual_budget)}`}>
              <Typography className="org-unit-budget" variant="caption" color="text.secondary">{money(unit.annual_budget)}</Typography>
            </Tooltip>
            <Button
              className="org-people-toggle"
              size="small"
              onClick={() => setPeopleExpanded((expanded) => !expanded)}
              endIcon={peopleExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              aria-expanded={peopleExpanded}
            >
              Пользователи · {peopleCount}
            </Button>
          </Box>
          <Collapse in={peopleExpanded} timeout="auto">
            <Box className="org-people-grid in-card">
              {responsibleUser ? <PersonCard user={responsibleUser} role="Ответственный сотрудник" /> : <PersonCard role="Ответственный сотрудник" vacancy />}
              {uniqueEconomists.map((user) => (
                <PersonCard key={user.id} user={user} role="Экономист" />
              ))}
              {uniqueEconomists.length === 0 && <PersonCard role="Экономист" vacancy />}
            </Box>
          </Collapse>
        </Box>}
      </Box>

      {(hasChildren || canCreateChild) && (
        <Box className={`org-connector ${hasChildren ? 'with-children' : 'leaf-end'}`}>
          <span className="org-connector-line org-connector-line-top" />
          {canCreateChild && (
            <Tooltip title="Добавить объединение">
              <IconButton className="org-add-on-line" size="small" onClick={onCreateChild} aria-label="Добавить объединение">
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {hasChildren && <span className="org-connector-line org-connector-line-bottom" />}
        </Box>
      )}

      {children}
    </Box>
  );
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const toast = useAppToast();
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
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);
  const [orgSearch, setOrgSearch] = useState('');
  const [rootUnitId, setRootUnitId] = useState('');
  const [orgZoom, setOrgZoom] = useState(0.6);
  const [orgPan, setOrgPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });

  const unitLevels = useMemo(() => new Map(units.map((unit) => [unit.id, unitLevel(unit.id, units)])), [units]);
  const assignableUnits = units.filter((unit) => unitLevels.get(unit.id) === 3);
  const employees = users.filter((user) => user.role === 'employee');
  const economists = users.filter((user) => user.role === 'economist');

  const responsibleQueries = useQueries({
    queries: assignableUnits.map((unit) => ({
      queryKey: ['responsible', unit.id],
      queryFn: async () => (await api.get<Responsible | null>(`/units/${unit.id}/responsible`)).data,
    })),
  });

  const responsiblesByUnit = useMemo(() => {
    const result = new Map<string, Responsible | null>();
    assignableUnits.forEach((unit, index) => result.set(unit.id, responsibleQueries[index]?.data ?? null));
    return result;
  }, [assignableUnits, responsibleQueries]);

  const economistsByUnit = useMemo(() => {
    const result = new Map<string, User[]>();
    for (const unit of assignableUnits) {
      const matched = assignments
        .filter((item) => item.is_active && item.unit_id === unit.id && item.assignment_type === 'module')
        .map((item) => users.find((user) => user.id === item.economist_id))
        .filter(Boolean) as User[];
      result.set(unit.id, dedupeUsers(matched));
    }
    return result;
  }, [assignableUnits, assignments, users]);

  const visibleTree = useMemo(() => {
    const query = orgSearch.trim().toLocaleLowerCase('ru-RU');
    const scopedTree = rootUnitId ? tree.filter((unit) => unit.id === rootUnitId) : tree;
    if (!query) return scopedTree;

    const filterNodes = (nodes: Unit[]): Unit[] => nodes.flatMap((unit) => {
      const children = filterNodes(unit.children || []);
      if (unit.name.toLocaleLowerCase('ru-RU').includes(query) || children.length > 0) {
        return [{ ...unit, children }];
      }
      return [];
    });

    return filterNodes(scopedTree);
  }, [tree, orgSearch, rootUnitId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['units'] });
    queryClient.invalidateQueries({ queryKey: ['units-tree'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: ['responsible'] });
  };

  const createUnit = useMutation({
    mutationFn: async (payload: {
      name: string;
      parent_id: string | null;
      is_active: boolean;
      uses_invest_projects: boolean;
      responsible_user_id?: string;
      economist_id?: string;
    }) => {
      const unit = (await api.post<Unit>('/units', {
        name: payload.name,
        parent_id: payload.parent_id,
        type: payload.parent_id ? 'module' : 'department',
        is_active: payload.is_active,
        uses_invest_projects: payload.uses_invest_projects,
      })).data;
      if (payload.responsible_user_id) {
        await api.post(`/units/${unit.id}/responsible`, { user_id: payload.responsible_user_id });
      }
      if (payload.economist_id) {
        await api.post('/economist-assignments', {
          economist_id: payload.economist_id,
          unit_id: unit.id,
          assignment_type: 'module',
          is_active: true,
        });
      }
      return unit;
    },
    onSuccess: (_data, payload) => {
      setDialog(null);
      refresh();
      toast('Объединение создано', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось создать элемент оргструктуры'), 'error');
    },
  });

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; is_active: boolean; parent_id: string | null; uses_invest_projects: boolean }) =>
      api.patch(`/units/${id}`, body),
    onSuccess: () => {
      setDialog(null);
      refresh();
      toast('Изменения сохранены', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить изменения'), 'error');
    },
  });

  const deleteUnit = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: (_data, deletedId) => {
      toast('Элемент оргструктуры удалён', 'success');
      if (dialog?.kind === 'edit' && dialog.unit.id === deletedId) {
        setDialog(null);
      }
      setDeleteTarget(null);
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить объединение'), 'error');
    },
  });

  const responsible = useMutation({
    mutationFn: ({ unitId, userId }: { unitId: string; userId: string }) =>
      api.post(`/units/${unitId}/responsible`, { user_id: userId }),
    onSuccess: refresh,
  });

  const unassignResponsible = useMutation({
    mutationFn: (unitId: string) => api.delete(`/units/${unitId}/responsible`),
    onSuccess: refresh,
    onError: (error) => toast(getErrorMessage(error, 'Не удалось снять ответственного сотрудника'), 'error'),
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
    onError: (error) => toast(getErrorMessage(error, 'Не удалось закрепить экономиста'), 'error'),
  });

  const unassign = useMutation({
    mutationFn: ({ unitId, economistId }: { unitId: string; economistId: string }) =>
      api.patch(`/economist-assignments/${encodeURIComponent(`${economistId}:${unitId}`)}`),
    onSuccess: () => {
      refresh();
      toast('Экономист снят с объединения', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось снять экономиста с объединения'), 'error'),
  });

  const submitDialog = (payload: {
    name: string;
    is_active: boolean;
    parent_id: string | null;
    uses_invest_projects: boolean;
    responsible_user_id?: string;
    economist_id?: string;
  }) => {
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
        Объединение
      </Button>
    ),
    [],
  );
  usePageChromeActions(addRootButton);

  const orgFilters = useMemo(
    () => (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} className="org-page-filters">
        <TextField
          select
          size="small"
          label="Объединение"
          value={rootUnitId}
          onChange={(event) => setRootUnitId(event.target.value)}
        >
          <MenuItem value="">Все объединения</MenuItem>
          {tree.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          label="Поиск в оргструктуре"
          value={orgSearch}
          onChange={(event) => setOrgSearch(event.target.value)}
        />
      </Stack>
    ),
    [orgSearch, rootUnitId, tree],
  );
  usePageChromeLeading(orgFilters);

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
        onCreateChild={() => setDialog({ kind: 'create-child', parent: unit, level: depth + 2 })}
        onEdit={() => setDialog({ kind: 'edit', unit, level: depth + 1 })}
      >
        {children.length > 0 ? (
          <Box className="org-branches" data-count={children.length} data-depth={depth}>
            {children.map((child) => renderNode(child, depth + 1))}
          </Box>
        ) : null}
      </OrgUnitCard>
    );
  };

  const changeOrgZoom = (delta: number) => {
    setOrgZoom((current) => Math.min(1.8, Math.max(0.6, Number((current + delta).toFixed(2)))));
  };

  const resetOrgViewport = () => {
    setOrgZoom(0.6);
    setOrgPan({ x: 0, y: 0 });
  };

  const handleOrgPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = { pointerX: event.clientX, pointerY: event.clientY, ...orgPan };
    setIsPanning(true);
  };

  const handleOrgPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    setOrgPan({
      x: panStart.current.x + event.clientX - panStart.current.pointerX,
      y: panStart.current.y + event.clientY - panStart.current.pointerY,
    });
  };

  const stopOrgPanning = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
  };

  return (
    <Stack spacing={3}>
      <Paper className={`org-chart-panel ${rootUnitId ? 'is-filtered' : ''}`} elevation={0}>
        {visibleTree.length > 0 ? (
          <>
            <Stack className="org-chart-toolbar" direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
              <Typography className="org-chart-zoom-value" variant="caption">{Math.round(orgZoom * 100)}%</Typography>
              <Tooltip title="Отдалить">
                <span><IconButton size="small" onClick={() => changeOrgZoom(-0.1)} disabled={orgZoom <= 0.6} aria-label="Отдалить оргструктуру"><ZoomOutIcon fontSize="small" /></IconButton></span>
              </Tooltip>
              <Tooltip title="Приблизить">
                <span><IconButton size="small" onClick={() => changeOrgZoom(0.1)} disabled={orgZoom >= 1.8} aria-label="Приблизить оргструктуру"><ZoomInIcon fontSize="small" /></IconButton></span>
              </Tooltip>
              <Tooltip title="Сбросить масштаб и положение">
                <IconButton size="small" onClick={resetOrgViewport} aria-label="Сбросить масштаб и положение оргструктуры"><CenterFocusStrongIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            <Box
              className={`org-chart-viewport ${isPanning ? 'is-panning' : ''}`}
              onPointerDown={handleOrgPointerDown}
              onPointerMove={handleOrgPointerMove}
              onPointerUp={stopOrgPanning}
              onPointerCancel={stopOrgPanning}
            >
              <Box className="org-chart-stage" style={{ transform: `translate3d(${orgPan.x}px, ${orgPan.y}px, 0) scale(${orgZoom})` }}>
                <Box className="org-forest">
                  {visibleTree.map((root) => (
                    <Box key={root.id} className="org-chart">
                      {renderNode(root, 0)}
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
            <Typography className="org-chart-pan-hint" variant="caption">Зажмите левую кнопку мыши и перетащите схему, чтобы переместить её</Typography>
          </>
        ) : (
          <Stack spacing={2} alignItems="flex-start">
            <Typography color="text.secondary">{orgSearch ? 'По запросу ничего не найдено.' : 'Пока нет объединений. Создайте первое объединение.'}</Typography>
            {!orgSearch && (
              <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialog({ kind: 'create-root' })}>
                Создать объединение
              </Button>
            )}
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
        onDelete={editingUnit ? () => setDeleteTarget(editingUnit) : undefined}
        deletePending={deleteUnit.isPending}
        onAssignResponsible={(userId) => {
          if (!editingUnit) return;
          responsible.mutate({ unitId: editingUnit.id, userId });
        }}
        onUnassignResponsible={() => {
          if (!editingUnit) return;
          unassignResponsible.mutate(editingUnit.id);
        }}
        onAssignEconomist={(economistId, unitId) => {
          if (!editingUnit || editingUnit.id !== unitId) return;
          assign.mutate({
            unitId,
            economistId,
            assignmentType: 'module',
          });
        }}
        onUnassignEconomist={(economistId) => {
          if (!editingUnit) return;
          unassign.mutate({ unitId: editingUnit.id, economistId });
        }}
        assignPending={responsible.isPending || unassignResponsible.isPending || assign.isPending || unassign.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить объединение?"
        description={`Объединение «${deleteTarget?.name || ''}» будет удалено. Это действие нельзя отменить.`}
        pending={deleteUnit.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteUnit.mutate(deleteTarget.id);
        }}
      />
    </Stack>
  );
}
