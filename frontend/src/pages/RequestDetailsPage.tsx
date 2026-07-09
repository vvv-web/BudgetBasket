import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
import { ItemStatusBadge, RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetItem, BudgetRequest, CatalogItem, FileAttachment, ItemStatus, User } from '../types';
import { CLOSED_REQUEST_STATUSES } from '../types';
import { downloadAuthorized, downloadBlob } from '../utils/download';
import { itemStatusLabels, money } from '../utils/labels';

function catalogLabel(item: CatalogItem, catalog: CatalogItem[]) {
  const parent = catalog.find((entry) => entry.id === item.parent_id);
  return parent ? `${parent.name} / ${item.name}` : item.name;
}

function leafItems(catalog: CatalogItem[]) {
  const hasChildren = new Set(catalog.filter((item) => item.parent_id).map((item) => item.parent_id));
  const children = catalog.filter((item) => item.parent_id);
  if (children.length > 0) return children;
  return catalog.filter((item) => !hasChildren.has(item.id));
}

function categoryName(catalog: CatalogItem[], itemId?: string | null) {
  const item = catalog.find((entry) => entry.id === itemId);
  if (!item?.parent_id) return '—';
  return catalog.find((entry) => entry.id === item.parent_id)?.name || '—';
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || (error instanceof Error ? error.message : fallback);
}

function ItemFilesCell({
  kind,
  itemId,
  canUpload,
  canDelete,
  uploadPending,
  onUpload,
}: {
  kind: 'dds' | 'invest';
  itemId: string;
  canUpload: boolean;
  canDelete: boolean;
  uploadPending: boolean;
  onUpload: (file: File) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [deleteTarget, setDeleteTarget] = useState<FileAttachment | null>(null);

  const { data: files = [] } = useQuery({
    queryKey: ['item-files', kind, itemId],
    queryFn: async () => (await api.get<FileAttachment[]>(`/${kind}-items/${itemId}/files`)).data,
  });

  const deleteFile = useMutation({
    mutationFn: (fileId: string | number) => api.delete(`/${kind}-items/${itemId}/files/${fileId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-files', kind, itemId] });
      toast('Файл удалён', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить файл'), 'error');
    },
  });

  return (
    <Stack spacing={1} alignItems="flex-start">
      {files.map((file) => (
        <Stack key={file.id} direction="row" spacing={0.5} alignItems="center">
          <Button
            size="small"
            startIcon={<FileDownloadIcon />}
            onClick={() => downloadAuthorized(`/files/${file.id}/download`, file.original_name)}
          >
            {file.original_name}
          </Button>
          {canDelete && (
            <Tooltip title="Удалить файл">
              <IconButton
                size="small"
                color="default"
                onClick={() => setDeleteTarget(file)}
                aria-label="Удалить файл"
                sx={{ color: 'text.secondary' }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ))}
      {canUpload && (
        <Button component="label" size="small" startIcon={<AttachFileIcon />} disabled={uploadPending}>
          Прикрепить
          <input
            hidden
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onUpload(file);
            }}
          />
        </Button>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить файл?"
        description={`Файл «${deleteTarget?.original_name || ''}» будет отвязан от строки. Если это последний файл, он будет удалён окончательно.`}
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteFile.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteFile.mutate(deleteTarget.id)}
      />
    </Stack>
  );
}

function AddItemForm({
  kind,
  requestId,
  catalog,
  disabled,
}: {
  kind: 'dds' | 'invest';
  requestId: string;
  catalog: CatalogItem[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(() => leafItems(catalog), [catalog]);
  const [article, setArticle] = useState<CatalogItem | null>(null);
  const [sumPlan, setSumPlan] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      api.post(`/requests/${requestId}/${kind}-items`, {
        [kind === 'dds' ? 'dds_id' : 'invest_id']: article?.id,
        sum_plan: sumPlan,
      }),
    onSuccess: () => {
      setArticle(null);
      setSumPlan(0);
      queryClient.invalidateQueries({ queryKey: ['request-details', requestId] });
    },
  });

  return (
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ my: 2 }} alignItems={{ lg: 'center' }}>
      <Autocomplete
        options={options}
        groupBy={(option) => catalog.find((entry) => entry.id === option.parent_id)?.name || 'Без категории'}
        value={article}
        onChange={(_, value) => setArticle(value)}
        getOptionLabel={(item) => catalogLabel(item, catalog)}
        disabled={disabled}
        sx={{ minWidth: 360, flex: 1 }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект'}
            placeholder="Поиск по категориям НСИ"
          />
        )}
      />
      <TextField
        label="Плановая сумма"
        type="number"
        value={sumPlan}
        onChange={(event) => setSumPlan(Number(event.target.value))}
        disabled={disabled}
        sx={{ minWidth: 160 }}
      />
      <Button variant="contained" onClick={() => create.mutate()} disabled={disabled || !article || sumPlan <= 0 || create.isPending}>
        Добавить строку
      </Button>
    </Stack>
  );
}

function ItemsTable({
  title,
  kind,
  request,
  user,
  items,
  catalog,
}: {
  title: string;
  kind: 'dds' | 'invest';
  request: BudgetRequest;
  user: User;
  items: BudgetItem[];
  catalog: CatalogItem[];
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);
  const disabledForEmployee = user.role !== 'employee' || request.status !== 'draft';
  const employeeCanEdit = user.role === 'employee' && request.status === 'draft';
  const canEmployeeUpload = user.role === 'employee' && ['draft', 'on_review'].includes(request.status);
  const canEconomist = user.role === 'economist' && request.status === 'on_review';
  const canDeleteItem = user.role === 'admin' || (user.role === 'employee' && request.status === 'draft');
  const canDeleteFiles = user.role === 'admin' || (user.role === 'employee' && ['draft', 'on_review'].includes(request.status));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request-details', request.id] });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<BudgetItem> }) => api.patch(`/${kind}-items/${id}`, body),
    onSuccess: () => {
      refresh();
      toast('Строка сохранена', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить строку'), 'error');
    },
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/${kind}-items/${itemId}`),
    onSuccess: () => {
      refresh();
      toast('Строка удалена', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить строку'), 'error');
    },
  });

  const upload = useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api.post(`/${kind}-items/${itemId}/files`, form);
    },
    onSuccess: (_response, variables) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['item-files', kind, variables.itemId] });
      toast('Файл прикреплён', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось прикрепить файл'), 'error');
    },
  });

  return (
    <>
      <Stack spacing={1}>
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary">
          {canEconomist
            ? 'Проверьте строки, укажите статус, утверждённую сумму и комментарий.'
            : employeeCanEdit
              ? 'Выберите категорию НСИ подразделения: статья ДДС или инвест-проект внутри категории.'
              : 'Строки заявки показаны в режиме просмотра. Редактирование доступно только до отправки на проверку.'}
        </Typography>
      </Stack>
      {employeeCanEdit && <AddItemForm kind={kind} requestId={request.id} catalog={catalog} disabled={disabledForEmployee} />}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Категория</TableCell>
            <TableCell>{kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект'}</TableCell>
            <TableCell>План</TableCell>
            <TableCell>Статус</TableCell>
            <TableCell>Утверждено</TableCell>
            <TableCell>Комментарий</TableCell>
            <TableCell>Файл</TableCell>
            <TableCell align="right">Действия</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const local = drafts[item.id] || {};
            const catalogId = kind === 'dds' ? item.dds_id : item.invest_id;
            return (
              <TableRow key={item.id}>
                <TableCell>{categoryName(catalog, catalogId)}</TableCell>
                <TableCell>{catalog.find((entry) => entry.id === catalogId)?.name || catalogId}</TableCell>
                <TableCell>{money(item.sum_plan)}</TableCell>
                <TableCell>
                  {canEconomist ? (
                    <TextField
                      select
                      size="small"
                      value={local.status || item.status}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [item.id]: { ...local, status: event.target.value as ItemStatus } })
                      }
                      sx={{ minWidth: 220 }}
                    >
                      {Object.entries(itemStatusLabels).map(([value, label]) => (
                        <MenuItem key={value} value={value}>
                          {label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <ItemStatusBadge status={item.status} />
                  )}
                </TableCell>
                <TableCell>
                  {canEconomist ? (
                    <TextField
                      size="small"
                      type="number"
                      value={local.sum_fact ?? item.sum_fact ?? ''}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [item.id]: { ...local, sum_fact: Number(event.target.value) } })
                      }
                    />
                  ) : (
                    money(item.sum_fact)
                  )}
                </TableCell>
                <TableCell>
                  {canEconomist ? (
                    <TextField
                      size="small"
                      value={local.comment ?? item.comment ?? ''}
                      onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...local, comment: event.target.value } })}
                    />
                  ) : (
                    item.comment || (item.status === 'rejected' ? 'Комментарий рекомендуется' : '—')
                  )}
                </TableCell>
                <TableCell>
                  <ItemFilesCell
                    kind={kind}
                    itemId={item.id}
                    canUpload={canEmployeeUpload}
                    canDelete={canDeleteFiles}
                    uploadPending={upload.isPending}
                    onUpload={(file) => upload.mutate({ itemId: item.id, file })}
                  />
                </TableCell>
                <TableCell align="right">
                  {canEconomist ? (
                    <Tooltip title="Сохранить">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => patch.mutate({ id: item.id, body: drafts[item.id] || {} })}
                        aria-label="Сохранить"
                      >
                        <SaveOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : canDeleteItem ? (
                    <Tooltip title="Удалить строку">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setDeleteTarget(item)}
                        aria-label="Удалить строку"
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить строку?"
        description={`Строка «${deleteTarget ? catalog.find((entry) => entry.id === (kind === 'dds' ? deleteTarget.dds_id : deleteTarget.invest_id))?.name || '' : ''}» будет удалена вместе со связями файлов.`}
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteItem.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteItem.mutate(deleteTarget.id)}
      />
    </>
  );
}

export default function RequestDetailsPage({ user }: { user: User }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const detailsKey = ['request-details', id];
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: request } = useQuery({
    queryKey: detailsKey,
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${id}`)).data,
  });
  const { data: dds = [] } = useQuery({
    queryKey: [...detailsKey, 'dds'],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/dds-items`)).data,
    enabled: !!request,
  });
  const { data: invest = [] } = useQuery({
    queryKey: [...detailsKey, 'invest'],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/invest-items`)).data,
    enabled: !!request,
  });

  const moduleId = request?.unit_id;
  const catalogParams = { module_id: moduleId, active_only: true };
  const { data: ddsCatalog = [] } = useQuery({
    queryKey: ['dds-catalog', moduleId],
    queryFn: async () => (await api.get<CatalogItem[]>('/catalog/dds', { params: catalogParams })).data,
    enabled: !!moduleId,
  });
  const { data: investCatalog = [] } = useQuery({
    queryKey: ['invest-catalog', moduleId],
    queryFn: async () => (await api.get<CatalogItem[]>('/catalog/invests', { params: catalogParams })).data,
    enabled: !!moduleId,
  });

  const lifecycle = useMutation({
    mutationFn: (action: string) => api.post(`/requests/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: detailsKey }),
  });

  const deleteRequest = useMutation({
    mutationFn: () => api.delete(`/requests/${id}`),
    onSuccess: () => {
      toast('Заявка удалена', 'success');
      setDeleteOpen(false);
      navigate('/requests');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить заявку'), 'error');
    },
  });

  const allItems = useMemo(() => [...dds, ...invest], [dds, invest]);
  const deletePreviewRows = useMemo(() => {
    const rows = [
      ...dds.map((item) => ({
        kind: 'ДДС',
        name: ddsCatalog.find((entry) => entry.id === item.dds_id)?.name || item.dds_id,
        sum: item.sum_plan,
      })),
      ...invest.map((item) => ({
        kind: 'Инвест',
        name: investCatalog.find((entry) => entry.id === item.invest_id)?.name || item.invest_id,
        sum: item.sum_plan,
      })),
    ];
    return rows.slice(0, 5);
  }, [dds, ddsCatalog, invest, investCatalog]);
  const canSubmit = user.role === 'employee' && request && request.status === 'draft' && allItems.length > 0;
  const canFinalize = user.role === 'economist' && request && request.status === 'on_review' && allItems.length > 0 && allItems.every((item) => item.status !== 'on_review');
  const isClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status);
  const canDelete = !!request && request.status === 'draft' && user.role === 'employee';

  const exportRequest = async () => {
    const response = await api.get(`/requests/${id}/export`, { responseType: 'blob' });
    downloadBlob(response.data, `request_${id.slice(0, 8)}.xlsx`);
  };

  if (!request) return <Typography>Загрузка заявки...</Typography>;

  return (
    <Stack spacing={3}>
      <Stack spacing={3}>
        <Card className={`metric-card ${isClosed ? 'fixed-request' : ''}`} elevation={0}>
          <CardContent>
            <Stack spacing={3}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} justifyContent="space-between">
                <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6">Сводка заявки</Typography>
                  <RequestStatusBadge status={request.status} />
                </Stack>
                <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                    {canDelete && (
                      <Button
                        startIcon={<DeleteOutlineIcon />}
                        variant="contained"
                        disableElevation
                        onClick={() => setDeleteOpen(true)}
                        sx={{
                          bgcolor: 'action.hover',
                          color: 'text.secondary',
                          '&:hover': {
                            bgcolor: 'action.selected',
                            boxShadow: 'none',
                          },
                        }}
                      >
                        Удалить заявку
                      </Button>
                    )}
                    {canSubmit && (
                      <Button startIcon={<SendIcon />} variant="contained" onClick={() => lifecycle.mutate('submit')}>
                        Отправить заявку
                      </Button>
                    )}
                    {canFinalize && (
                      <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('finalize')}>
                        Завершить проверку
                      </Button>
                    )}
                    {isClosed && (
                      <Button startIcon={<FileDownloadIcon />} variant="outlined" onClick={exportRequest}>
                        Экспорт Excel
                      </Button>
                    )}
                    {user.role === 'economist' && isClosed && (
                      <Button startIcon={<UndoIcon />} variant="outlined" onClick={() => lifecycle.mutate('reopen')}>
                        Вернуть в черновик
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} flexWrap="wrap">
                <Typography>План: <b>{money(request.summary?.planned_sum)}</b></Typography>
                <Typography>Утверждено: <b>{money(request.summary?.approved_sum)}</b></Typography>
                <Typography>Строк: <b>{request.summary?.items_count || 0}</b></Typography>
                <Typography>Принято: <b>{request.summary?.accepted_count || 0}</b></Typography>
                <Typography>Отказано: <b>{request.summary?.rejected_count || 0}</b></Typography>
                <Typography>На рассмотрении: <b>{request.summary?.in_review_count || 0}</b></Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Paper className="surface-pad" elevation={0}>
          <ItemsTable title="Строки ДДС" kind="dds" request={request} user={user} items={dds} catalog={ddsCatalog} />
        </Paper>

        <Paper className="surface-pad" elevation={0}>
          <ItemsTable title="Строки инвест-проектов" kind="invest" request={request} user={user} items={invest} catalog={investCatalog} />
        </Paper>
      </Stack>

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить заявку?"
        maxWidth="md"
        description={
          <Stack spacing={1.5}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 0.75 }}>Тип</TableCell>
                  <TableCell sx={{ py: 0.75 }}>Статья / проект</TableCell>
                  <TableCell sx={{ py: 0.75 }} align="right">План</TableCell>
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
                {allItems.length > deletePreviewRows.length && (
                  <TableRow>
                    <TableCell sx={{ py: 0.75 }} colSpan={3}>
                      Ещё строк: {allItems.length - deletePreviewRows.length}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Stack>
        }
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteRequest.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteRequest.mutate()}
      />
    </Stack>
  );
}
