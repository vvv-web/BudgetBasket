import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RequestStatusBadge } from '../components/StatusBadge';
import { useAppToast } from '../components/Layout';
import type { BudgetItem, BudgetRequest, CatalogItem, RequestStatus, Unit, User } from '../types';
import { CLOSED_REQUEST_STATUSES, EXPORTABLE_REQUEST_STATUSES } from '../types';
import { downloadBlob } from '../utils/download';
import { money, requestStatusLabels } from '../utils/labels';

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || (error instanceof Error ? error.message : fallback);
}

function RequestCreatePanel({
  user,
  employeeModules,
  unitId,
  onUnitIdChange,
  onCreate,
  pending,
}: {
  user: User;
  employeeModules: Unit[];
  unitId: string;
  onUnitIdChange: (value: string) => void;
  onCreate: () => void;
  pending: boolean;
}) {
  if (user.role !== 'employee') return null;

  const singleModule = employeeModules.length === 1 ? employeeModules[0] : null;
  const hasModules = employeeModules.length > 0;

  return (
    <Paper className="surface-pad" elevation={0}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ md: 'center' }}>
          <div>
            <Typography variant="h6">Новая заявка</Typography>
            <Typography color="text.secondary">
              Заявка создаётся сразу в нужном подразделении. Если доступен один вариант, он подставится автоматически.
            </Typography>
          </div>
          {singleModule && (
            <Alert severity="info" sx={{ minWidth: { md: 420 } }}>
              Доступно одно подразделение, оно выбрано автоматически.
            </Alert>
          )}
          {!hasModules && (
            <Alert severity="warning" sx={{ minWidth: { md: 420 } }}>
              У текущего сотрудника нет доступных подразделений. Назначьте сотрудника в оргструктуре.
            </Alert>
          )}
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          {singleModule ? (
            <TextField
              label="Подразделение"
              value={singleModule.name}
              disabled
              helperText="Подразделение выбрано автоматически"
              sx={{ minWidth: 360, flex: 1 }}
            />
          ) : (
            <TextField
              select
              label="Подразделение"
              value={unitId}
              onChange={(event) => onUnitIdChange(event.target.value)}
              disabled={!hasModules}
              sx={{ minWidth: 360, flex: 1 }}
            >
              <MenuItem value="">Выберите подразделение</MenuItem>
              {employeeModules.map((unit) => (
                <MenuItem key={unit.id} value={unit.id}>
                  {unit.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => onCreate()} disabled={pending || !unitId}>
            Создать заявку
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function RequestsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [filters, setFilters] = useState({ status: '' });
  const [withdrawTarget, setWithdrawTarget] = useState<BudgetRequest | null>(null);
  const [createError, setCreateError] = useState('');
  const [requestDraft, setRequestDraft] = useState({ unit_id: '' });
  const [exportError, setExportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    statuses: [...EXPORTABLE_REQUEST_STATUSES],
    unit_id: '',
    include_files: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<BudgetRequest | null>(null);
  const deleteTargetId = deleteTarget?.id || '';

  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const { data: deleteTargetRequest } = useQuery({
    queryKey: ['request-delete-preview', deleteTargetId],
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${deleteTargetId}`)).data,
    enabled: !!deleteTargetId,
  });
  const { data: deleteTargetDds = [] } = useQuery({
    queryKey: ['request-delete-preview-dds', deleteTargetId],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${deleteTargetId}/dds-items`)).data,
    enabled: !!deleteTargetRequest,
  });
  const { data: deleteTargetInvest = [] } = useQuery({
    queryKey: ['request-delete-preview-invest', deleteTargetId],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${deleteTargetId}/invest-items`)).data,
    enabled: !!deleteTargetRequest,
  });
  const { data: deleteTargetDdsCatalog = [] } = useQuery({
    queryKey: ['request-delete-preview-dds-catalog', deleteTargetRequest?.unit_id],
    queryFn: async () =>
      (
        await api.get<CatalogItem[]>('/catalog/dds', {
          params: { module_id: deleteTargetRequest?.unit_id, active_only: true },
        })
      ).data,
    enabled: !!deleteTargetRequest?.unit_id,
  });
  const { data: deleteTargetInvestCatalog = [] } = useQuery({
    queryKey: ['request-delete-preview-invest-catalog', deleteTargetRequest?.unit_id],
    queryFn: async () =>
      (
        await api.get<CatalogItem[]>('/catalog/invests', {
          params: { module_id: deleteTargetRequest?.unit_id, active_only: true },
        })
      ).data,
    enabled: !!deleteTargetRequest?.unit_id,
  });
  const { data = [] } = useQuery({
    queryKey: ['requests', filters],
    queryFn: async () =>
      (
        await api.get<BudgetRequest[]>('/requests', {
          params: { status: filters.status || undefined },
        })
      ).data,
  });

  const allModules = units.filter((unit) => unit.type === 'department' || unit.type === 'module');
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const formatUnitName = (unitId: string | null | undefined) => units.find((unit) => unit.id === unitId)?.name || unitId || '—';
  const employeeUnitNames = useMemo(
    () => (user.unit_ids || []).map((unitId) => formatUnitName(unitId)).filter(Boolean),
    [units, user.unit_ids],
  );

  const employeeModules = useMemo(() => {
    if (user.role !== 'employee') return allModules;
    const assignedUnits = new Set(user.unit_ids || []);
    return allModules.filter((module) => {
      let current: Unit | undefined = module;
      while (current) {
        if (assignedUnits.has(current.id)) return true;
        current = current.parent_id ? unitById.get(current.parent_id) : undefined;
      }
      return false;
    });
  }, [allModules, unitById, user.role, user.unit_ids]);

  useEffect(() => {
    if (user.role !== 'employee') return;
    if (employeeModules.length === 1 && requestDraft.unit_id !== employeeModules[0].id) {
      setRequestDraft({ unit_id: employeeModules[0].id });
      return;
    }
    if (requestDraft.unit_id && !employeeModules.some((module) => module.id === requestDraft.unit_id)) {
      setRequestDraft({ unit_id: '' });
    }
  }, [employeeModules, requestDraft.unit_id, user.role]);

  const create = useMutation({
    mutationFn: () => api.post<BudgetRequest>('/requests', requestDraft),
    onSuccess: (response) => {
      setCreateError('');
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка создана', 'success');
      setCreateOpen(false);
      navigate(`/requests/${response.data.id}`);
    },
    onError: (error) => {
      setCreateError(getErrorMessage(error, 'Заявку не удалось создать'));
      toast('Не удалось создать заявку', 'error');
    },
  });

  const deleteRequest = useMutation({
    mutationFn: (requestId: string) => api.delete(`/requests/${requestId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка удалена', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить заявку'), 'error');
    },
  });

  const withdrawRequest = useMutation({
    mutationFn: (requestId: string) => api.post(`/requests/${requestId}/withdraw`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка отозвана в черновик', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось отозвать заявку'), 'error'),
  });

  const exportClosed = async () => {
    setExportError('');
    try {
      const response = await api.get('/requests/export/closed', {
        params: {
          unit_id: exportSettings.unit_id || undefined,
          statuses: exportSettings.statuses.join(','),
          include_files: exportSettings.include_files,
        },
        responseType: 'blob',
      });
      downloadBlob(response.data, exportSettings.include_files ? 'Утверждение_бюджета.zip' : 'Утверждение_бюджета.xlsx');
      setExportOpen(false);
    } catch {
      setExportError('Нет заявок для выбранных настроек экспорта или недостаточно прав.');
    }
  };

  const exportStatusOptions: RequestStatus[] = [...EXPORTABLE_REQUEST_STATUSES, 'rejected'];

  const toggleExportStatus = (status: RequestStatus) => {
    setExportSettings((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }));
  };

  const deletePreviewRows = useMemo(() => {
    const ddsRows = deleteTargetDds.map((item) => ({
      kind: 'ДДС',
      name: deleteTargetDdsCatalog.find((entry) => entry.id === item.dds_id)?.name || item.dds_id,
      sum: item.sum_plan,
    }));
    const investRows = deleteTargetInvest.map((item) => ({
      kind: 'Инвест',
      name: deleteTargetInvestCatalog.find((entry) => entry.id === item.invest_id)?.name || item.invest_id,
      sum: item.sum_plan,
    }));
    return [...ddsRows, ...investRows].slice(0, 5);
  }, [deleteTargetDds, deleteTargetDdsCatalog, deleteTargetInvest, deleteTargetInvestCatalog]);

  return (
    <Stack spacing={3}>
      {exportError && <Alert severity="warning">{exportError}</Alert>}
      {createError && <Alert severity="error">{createError}</Alert>}

      <Paper className="surface-pad" elevation={0}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ flex: 1 }}>
              <TextField select label="Статус" value={filters.status} onChange={(event) => setFilters({ status: event.target.value })} sx={{ minWidth: 220 }}>
                <MenuItem value="">Все</MenuItem>
                {Object.entries(requestStatusLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {user.role === 'employee' ? (
                <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)} disabled={employeeModules.length === 0}>
                  Добавить заявку
                </Button>
              ) : null}
              <Button startIcon={<TuneOutlinedIcon />} variant="outlined" onClick={() => setExportOpen(true)}>
                Настроить экспорт
              </Button>
            </Stack>
          </Stack>
          {user.role === 'employee' ? (
            <Alert severity="info" variant="outlined">
              Объединение сотрудника: {employeeUnitNames.length ? employeeUnitNames.join(', ') : 'не назначено'}
            </Alert>
          ) : null}
        </Stack>
      </Paper>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm" className="profile-dialog">
        <DialogTitle>Добавить заявку</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Alert severity="info" variant="outlined">
              Объединение сотрудника: {employeeUnitNames.length ? employeeUnitNames.join(', ') : 'не назначено'}
            </Alert>
            <Typography color="text.secondary">Выберите объединение, к которому будет привязана бюджетная заявка.</Typography>
            <TextField select label="Объединение заявки" value={requestDraft.unit_id} onChange={(event) => setRequestDraft({ unit_id: event.target.value })} fullWidth>
              <MenuItem value="">Выберите объединение заявки</MenuItem>
              {employeeModules.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Отмена</Button>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={!requestDraft.unit_id || create.isPending}>Создать заявку</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} fullWidth maxWidth="sm" className="export-dialog">
        <DialogTitle>Настройки экспорта</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography fontWeight={700}>Заявки и статусы</Typography>
                <Tooltip title="По умолчанию выгружаются утверждённые заявки. При необходимости отдельно включите отклонённые; отменённые заявки не экспортируются.">
                  <IconButton size="small" aria-label="Нюансы статусов экспорта"><InfoOutlinedIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
              <Typography variant="body2" color="text.secondary">Выберите один или несколько статусов. По умолчанию выгружаются все доступные для экспорта заявки.</Typography>
              <FormGroup sx={{ mt: 0.5 }}>
                {exportStatusOptions.map((status) => (
                  <FormControlLabel
                    key={status}
                    control={<Checkbox checked={exportSettings.statuses.includes(status)} onChange={() => toggleExportStatus(status)} />}
                    label={requestStatusLabels[status]}
                  />
                ))}
              </FormGroup>
            </Stack>

            <Stack spacing={0.75}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography fontWeight={700}>Подразделение</Typography>
                <Tooltip title="Оставьте «Все доступные подразделения», чтобы получить общий экспорт. При выборе подразделения в файл попадут только его заявки.">
                  <IconButton size="small" aria-label="Нюансы выбора подразделения"><InfoOutlinedIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
              <TextField select label="Подразделение" value={exportSettings.unit_id} onChange={(event) => setExportSettings((current) => ({ ...current, unit_id: event.target.value }))} fullWidth>
                <MenuItem value="">Все доступные подразделения</MenuItem>
                {allModules.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
              </TextField>
            </Stack>

            <Stack spacing={0.25}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <FormControlLabel
                  sx={{ mr: 0 }}
                  control={<Switch checked={exportSettings.include_files} onChange={(event) => setExportSettings((current) => ({ ...current, include_files: event.target.checked }))} />}
                  label="Включить прикреплённые файлы"
                />
                <Tooltip title="С файлами выгружается ZIP-архив: Excel и папка вложений, разложенных по заявкам и строкам бюджета. Без файлов будет скачан только Excel.">
                  <IconButton size="small" aria-label="Нюансы выгрузки файлов"><InfoOutlinedIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
              <Typography variant="body2" color="text.secondary">Доступ к вложениям проверяется теми же правами, что и доступ к заявкам.</Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setExportOpen(false)}>Отмена</Button>
          <Button variant="contained" startIcon={<FileDownloadIcon />} onClick={exportClosed} disabled={exportSettings.statuses.length === 0}>
            Экспортировать
          </Button>
        </DialogActions>
      </Dialog>

      <Paper className="table-surface" elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Объединение заявки</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>План</TableCell>
              <TableCell>Утверждено</TableCell>
              <TableCell>Строк</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item) => {
              const canDelete = item.status === 'draft' && user.role === 'employee';
              const canWithdraw = item.status === 'on_review' && user.role === 'employee';
              const unitName = formatUnitName(item.unit_id);
              return (
              <TableRow
                  key={item.id}
                  hover
                  onClick={() => navigate(`/requests/${item.id}`)}
                  sx={{ cursor: 'pointer' }}
                  className={CLOSED_REQUEST_STATUSES.includes(item.status) && item.status !== 'cancelled' ? 'fixed-request' : ''}
                >
                  <TableCell>{unitName}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <RequestStatusBadge status={item.status} />
                      {item.budget_frozen && (
                        <Chip size="small" icon={<LockOutlinedIcon />} label="Зафиксирован" color="warning" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{money(item.summary?.planned_sum)}</TableCell>
                  <TableCell>{money(item.summary?.approved_sum ?? (item.status === 'cancelled' ? 0 : item.sum))}</TableCell>
                  <TableCell>{item.summary?.items_count || 0}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {canWithdraw ? (
                        <Button size="small" startIcon={<UndoIcon />} onClick={(event) => { event.stopPropagation(); setWithdrawTarget(item); }} disabled={withdrawRequest.isPending}>
                          Отозвать
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button size="small" startIcon={<DeleteOutlineIcon />} color="error" onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }}>
                          Удалить
                        </Button>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={!!withdrawTarget}
        title="Отозвать заявку в черновик?"
        description="Заявка вернётся в черновик, и её строки снова станут доступны для редактирования."
        confirmLabel="Отозвать"
        pending={withdrawRequest.isPending}
        onClose={() => setWithdrawTarget(null)}
        onConfirm={() => {
          if (!withdrawTarget) return;
          withdrawRequest.mutate(withdrawTarget.id, { onSuccess: () => setWithdrawTarget(null) });
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить заявку?"
        maxWidth="md"
        description={
          deleteTarget ? (
            <Stack spacing={1.5}>
              {deleteTargetRequest ? (
                <Typography variant="body2" color="text.secondary">
                  {deleteTargetRequest.unit_id ? `Заявка привязана к объединению: ${formatUnitName(deleteTargetRequest.unit_id)}` : ''}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Загрузка состава заявки...
                </Typography>
              )}
              {deletePreviewRows.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ py: 0.75 }}>Тип</TableCell>
                      <TableCell sx={{ py: 0.75 }}>Статья / проект</TableCell>
                      <TableCell sx={{ py: 0.75 }} align="right">
                        План
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deletePreviewRows.map((row, index) => (
                      <TableRow key={`${row.kind}-${row.name}-${index}`}>
                        <TableCell sx={{ py: 0.75 }}>{row.kind}</TableCell>
                        <TableCell sx={{ py: 0.75 }}>{row.name}</TableCell>
                        <TableCell sx={{ py: 0.75 }} align="right">
                          {money(row.sum)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {deleteTargetDds.length + deleteTargetInvest.length > deletePreviewRows.length && (
                      <TableRow>
                        <TableCell sx={{ py: 0.75 }} colSpan={3}>
                          Ещё строк: {deleteTargetDds.length + deleteTargetInvest.length - deletePreviewRows.length}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </Stack>
          ) : null
        }
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteRequest.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteRequest.mutate(deleteTarget.id)}
      />
    </Stack>
  );
}
