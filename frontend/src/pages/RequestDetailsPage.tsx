import AttachFileIcon from '@mui/icons-material/AttachFile';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { PageActions } from '../components/PageActions';
import { ItemStatusBadge, RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetItem, BudgetRequest, CatalogItem, ItemStatus, User } from '../types';
import { CLOSED_REQUEST_STATUSES } from '../types';
import { downloadBlob } from '../utils/download';
import { itemStatusLabels, money } from '../utils/labels';

const steps = ['Сводка', 'ДДС', 'Инвест-проекты', 'Проверка'];

function catalogLabel(item: CatalogItem, catalog: CatalogItem[]) {
  const parent = catalog.find((entry) => entry.id === item.parent_id);
  return parent ? `${parent.name} / ${item.name}` : item.name;
}

function leafItems(catalog: CatalogItem[]) {
  const hasChildren = new Set(catalog.filter((item) => item.parent_id).map((item) => item.parent_id));
  // Prefer actual children (subcategories). If a root has no children, keep it selectable.
  const children = catalog.filter((item) => item.parent_id);
  if (children.length > 0) {
    return children;
  }
  return catalog.filter((item) => !hasChildren.has(item.id));
}

function categoryName(catalog: CatalogItem[], itemId?: string | null) {
  const item = catalog.find((entry) => entry.id === itemId);
  if (!item?.parent_id) return '—';
  return catalog.find((entry) => entry.id === item.parent_id)?.name || '—';
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
            placeholder="Поиск по категориям НСИ подразделения"
          />
        )}
      />
      <TextField label="Плановая сумма" type="number" value={sumPlan} onChange={(event) => setSumPlan(Number(event.target.value))} disabled={disabled} sx={{ minWidth: 160 }} />
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
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const disabledForEmployee = user.role !== 'employee' || request.status !== 'draft';
  const canEconomist = user.role === 'economist' && request.status === 'on_review';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request-details', request.id] });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<BudgetItem> }) => api.patch(`/${kind}-items/${id}`, body), onSuccess: refresh });
  const upload = useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await api.post('/files/upload', form);
      return api.post(`/${kind}-items/${itemId}/files`, { file_id: uploaded.data.id });
    },
    onSuccess: refresh,
  });

  return (
    <Paper className="surface-pad" elevation={0}>
      <Stack spacing={1}>
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary">
          {user.role === 'economist'
            ? 'Проверьте строки, укажите статус, утверждённую сумму и комментарий.'
            : 'Выберите подкатегорию НСИ подразделения: статья ДДС или инвест-проект внутри категории.'}
        </Typography>
      </Stack>
      {user.role === 'employee' && (
        <AddItemForm kind={kind} requestId={request.id} catalog={catalog} disabled={disabledForEmployee} />
      )}
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
            <TableCell>Действия</TableCell>
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
                    <TextField select size="small" value={local.status || item.status} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...local, status: event.target.value as ItemStatus } })} sx={{ minWidth: 220 }}>
                      {Object.entries(itemStatusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                  ) : <ItemStatusBadge status={item.status} />}
                </TableCell>
                <TableCell>
                  {canEconomist ? <TextField size="small" type="number" value={local.sum_fact ?? item.sum_fact ?? ''} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...local, sum_fact: Number(event.target.value) } })} /> : money(item.sum_fact)}
                </TableCell>
                <TableCell>
                  {canEconomist ? <TextField size="small" value={local.comment ?? item.comment ?? ''} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...local, comment: event.target.value } })} /> : item.comment || (item.status === 'rejected' ? 'Комментарий рекомендуется' : '—')}
                </TableCell>
                <TableCell>
                  {user.role === 'employee' && !disabledForEmployee && (
                    <Button component="label" size="small" startIcon={<AttachFileIcon />}>
                      Прикрепить
                      <input hidden type="file" onChange={(event) => event.target.files?.[0] && upload.mutate({ itemId: item.id, file: event.target.files[0] })} />
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  {canEconomist && <Button size="small" variant="outlined" onClick={() => patch.mutate({ id: item.id, body: drafts[item.id] || {} })}>Сохранить</Button>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Paper>
  );
}

export default function RequestDetailsPage({ user }: { user: User }) {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const detailsKey = ['request-details', id];
  const { data: request } = useQuery({ queryKey: detailsKey, queryFn: async () => (await api.get<BudgetRequest>(`/requests/${id}`)).data });
  const { data: dds = [] } = useQuery({ queryKey: [...detailsKey, 'dds'], queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/dds-items`)).data, enabled: !!request });
  const { data: invest = [] } = useQuery({ queryKey: [...detailsKey, 'invest'], queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/invest-items`)).data, enabled: !!request });

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

  const lifecycle = useMutation({ mutationFn: (action: string) => api.post(`/requests/${id}/${action}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: detailsKey }) });

  const allItems = useMemo(() => [...dds, ...invest], [dds, invest]);
  const canSubmit = user.role === 'employee' && request && request.status === 'draft' && allItems.length > 0;
  const canReview = user.role === 'economist' && request && request.status === 'on_review';
  const canFinalize = user.role === 'economist' && request && request.status === 'on_review' && allItems.length > 0 && allItems.every((item) => item.status !== 'on_review');
  const isClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status);

  const exportRequest = async () => {
    const response = await api.get(`/requests/${id}/export`, { responseType: 'blob' });
    downloadBlob(response.data, `request_${id.slice(0, 8)}.xlsx`);
  };

  if (!request) return <Typography>Загрузка заявки...</Typography>;

  return (
    <Stack spacing={3}>
      <PageActions>
        {isClosed && (
          <Button startIcon={<FileDownloadIcon />} variant="outlined" onClick={exportRequest}>
            Экспорт Excel
          </Button>
        )}
        {canReview && !canFinalize && <Button startIcon={<PlayArrowIcon />} variant="outlined" onClick={() => lifecycle.mutate('start-review')}>Начать проверку</Button>}
        {canFinalize && <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('finalize')}>Завершить проверку</Button>}
        {user.role === 'economist' && isClosed && <Button startIcon={<UndoIcon />} variant="outlined" onClick={() => lifecycle.mutate('reopen')}>Вернуть в черновик</Button>}
      </PageActions>
      <Stack direction="row" spacing={1} alignItems="center">
        <RequestStatusBadge status={request.status} />
        {isClosed && <Typography color="success.main" variant="body2">Заявка закрыта и недоступна для редактирования</Typography>}
      </Stack>

      <Paper className="wizard-shell" elevation={0}>
        <Stack spacing={3}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {activeStep === 0 && (
            <Card className={`metric-card ${isClosed ? 'fixed-request' : ''}`} elevation={0}>
              <CardContent>
                <Stack spacing={3}>
                  <Typography variant="h6">Сводка перед заполнением</Typography>
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
          )}
          {activeStep === 1 && <ItemsTable title="Строки ДДС" kind="dds" request={request} user={user} items={dds} catalog={ddsCatalog} />}
          {activeStep === 2 && <ItemsTable title="Строки инвест-проектов" kind="invest" request={request} user={user} items={invest} catalog={investCatalog} />}
          {activeStep === 3 && (
            <Paper className="surface-pad" elevation={0}>
              <Stack spacing={2}>
                <Typography variant="h6">Финальная проверка</Typography>
                <Typography color="text.secondary">
                  Проверьте количество строк и статусы. Сотрудник отправляет заявку экономисту, экономист завершает проверку после обработки всех строк.
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Typography>Всего строк: <b>{allItems.length}</b></Typography>
                  <Typography>На рассмотрении: <b>{request.summary?.in_review_count || 0}</b></Typography>
                  <Typography>Утверждено: <b>{money(request.summary?.approved_sum)}</b></Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  {canSubmit && <Button startIcon={<SendIcon />} variant="contained" onClick={() => lifecycle.mutate('submit')}>Отправить заявку</Button>}
                  {canFinalize && <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('finalize')}>Завершить проверку</Button>}
                </Stack>
              </Stack>
            </Paper>
          )}

          <Stack direction="row" justifyContent="space-between">
            <Button variant="outlined" disabled={activeStep === 0} onClick={() => setActiveStep((step) => step - 1)}>Назад</Button>
            <Button variant="contained" disabled={activeStep === steps.length - 1} onClick={() => setActiveStep((step) => step + 1)}>Далее</Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
