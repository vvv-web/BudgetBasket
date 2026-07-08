import AttachFileIcon from '@mui/icons-material/AttachFile';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
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
import { ItemStatusBadge, RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetItem, BudgetRequest, CatalogItem, ItemStatus, User } from '../types';
import { itemStatusLabels, money } from '../utils/labels';

const steps = ['Сводка', 'ДДС', 'Инвест-проекты', 'Проверка'];

function AddItemForm({ kind, requestId, catalog, disabled }: { kind: 'dds' | 'invest'; requestId: string; catalog: CatalogItem[]; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ id: '', sum_plan: 0 });
  const create = useMutation({
    mutationFn: () => api.post(`/requests/${requestId}/${kind}-items`, { [kind === 'dds' ? 'dds_id' : 'invest_id']: form.id, sum_plan: form.sum_plan }),
    onSuccess: () => {
      setForm({ id: '', sum_plan: 0 });
      queryClient.invalidateQueries({ queryKey: ['request-details', requestId] });
    },
  });
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
      <TextField select label={kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект'} value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} disabled={disabled} sx={{ minWidth: 280 }}>
        {catalog.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
      </TextField>
      <TextField label="Плановая сумма" type="number" value={form.sum_plan} onChange={(event) => setForm({ ...form, sum_plan: Number(event.target.value) })} disabled={disabled} />
      <Button variant="contained" onClick={() => create.mutate()} disabled={disabled || !form.id || form.sum_plan <= 0}>
        Добавить строку
      </Button>
    </Stack>
  );
}

function ItemsTable({ title, kind, request, user, items, catalog }: { title: string; kind: 'dds' | 'invest'; request: BudgetRequest; user: User; items: BudgetItem[]; catalog: CatalogItem[] }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const disabledForEmployee = user.role !== 'employee' || !['draft', 'unfrozen'].includes(request.status);
  const canEconomist = user.role === 'economist' && request.status !== 'fixed';
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
          {user.role === 'economist' ? 'Проверьте строки, укажите статус, утвержденную сумму и комментарий.' : 'Добавьте строки бюджета и приложите подтверждающие файлы.'}
        </Typography>
      </Stack>
      {user.role === 'employee' && <AddItemForm kind={kind} requestId={request.id} catalog={catalog} disabled={disabledForEmployee} />}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Статья</TableCell>
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
  const { data: ddsCatalog = [] } = useQuery({ queryKey: ['dds-catalog'], queryFn: async () => (await api.get<CatalogItem[]>('/catalog/dds')).data });
  const { data: investCatalog = [] } = useQuery({ queryKey: ['invest-catalog'], queryFn: async () => (await api.get<CatalogItem[]>('/catalog/invests')).data });
  const lifecycle = useMutation({ mutationFn: (action: string) => api.post(`/requests/${id}/${action}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: detailsKey }) });

  const allItems = useMemo(() => [...dds, ...invest], [dds, invest]);
  const canSubmit = user.role === 'employee' && request && ['draft', 'unfrozen'].includes(request.status) && allItems.length > 0;
  const canReview = user.role === 'economist' && request && ['submitted', 'unfrozen', 'in_review'].includes(request.status);
  const canFix = user.role === 'economist' && request && request.status !== 'fixed' && allItems.length > 0 && allItems.every((item) => item.status !== 'in_review');

  if (!request) return <Typography>Загрузка заявки...</Typography>;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
        <div>
          <Typography className="page-title">Мастер заявки</Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <RequestStatusBadge status={request.status} />
            {request.status === 'fixed' && <Typography color="success.main">Заявка зафиксирована и недоступна для редактирования</Typography>}
          </Stack>
        </div>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {canReview && <Button startIcon={<PlayArrowIcon />} variant="outlined" onClick={() => lifecycle.mutate('start-review')}>Начать проверку</Button>}
          {canFix && <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('fix')}>Зафиксировать</Button>}
          {user.role === 'economist' && request.status === 'fixed' && <Button startIcon={<UndoIcon />} variant="outlined" onClick={() => lifecycle.mutate('unfreeze')}>Разморозить</Button>}
        </Stack>
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
            <Card className={`metric-card ${request.status === 'fixed' ? 'fixed-request' : ''}`} elevation={0}>
              <CardContent>
                <Stack spacing={3}>
                  <Typography variant="h6">Сводка перед заполнением</Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
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
                  Проверьте количество строк и статусы. Сотрудник отправляет заявку экономисту, экономист фиксирует бюджет после обработки всех строк.
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Typography>Всего строк: <b>{allItems.length}</b></Typography>
                  <Typography>На рассмотрении: <b>{request.summary?.in_review_count || 0}</b></Typography>
                  <Typography>Утверждено: <b>{money(request.summary?.approved_sum)}</b></Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  {canSubmit && <Button startIcon={<SendIcon />} variant="contained" onClick={() => lifecycle.mutate('submit')}>Отправить заявку</Button>}
                  {canFix && <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('fix')}>Зафиксировать бюджет</Button>}
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
