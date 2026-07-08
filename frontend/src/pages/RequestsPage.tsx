import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
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
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetRequest, Unit, User } from '../types';
import { money, requestStatusLabels } from '../utils/labels';

interface Responsible {
  unit_id: string;
  user_id: string;
  is_active: boolean;
}

const createSteps = ['Модуль', 'Подтверждение'];

export default function RequestsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ status: '', unit_id: '' });
  const [wizardStep, setWizardStep] = useState(0);
  const [newRequest, setNewRequest] = useState({ unit_id: '' });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const { data = [] } = useQuery({
    queryKey: ['requests', filters],
    queryFn: async () => (await api.get<BudgetRequest[]>('/requests', { params: { status: filters.status || undefined, unit_id: filters.unit_id || undefined } })).data,
  });

  const allModules = units.filter((unit) => unit.type === 'module');
  const responsibleQueries = useQueries({
    queries: allModules.map((module) => ({
      queryKey: ['responsible', module.id],
      queryFn: async () => (await api.get<Responsible | null>(`/units/${module.id}/responsible`)).data,
      enabled: user.role === 'employee',
    })),
  });

  const employeeModules = useMemo(() => {
    if (user.role !== 'employee') return allModules;
    return allModules.filter((module, index) => responsibleQueries[index]?.data?.user_id === user.id && responsibleQueries[index]?.data?.is_active);
  }, [allModules, responsibleQueries, user.id, user.role]);

  const selectedModule = employeeModules.find((unit) => unit.id === newRequest.unit_id);
  const create = useMutation({
    mutationFn: () => api.post<BudgetRequest>('/requests', newRequest),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      navigate(`/requests/${response.data.id}`);
    },
  });

  return (
    <Stack spacing={3}>
      <div>
        <Typography className="page-title">Заявки</Typography>
        <Typography className="page-subtitle">Форма показывает только модули, доступные текущей роли по обновленной data-схеме.</Typography>
      </div>

      {user.role === 'employee' && (
        <Paper className="wizard-shell" elevation={0}>
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
              <div>
                <Typography variant="h6">Новая заявка</Typography>
                <Typography color="text.secondary">Сотрудник может создать заявку только по модулю, где он назначен активным ответственным.</Typography>
              </div>
              <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setWizardStep(0)}>
                Начать заново
              </Button>
            </Stack>
            <Stepper activeStep={wizardStep} alternativeLabel>
              {createSteps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {employeeModules.length === 0 && (
              <Alert severity="warning">У текущего сотрудника нет активных ответственных модулей. Назначьте ответственного в оргструктуре.</Alert>
            )}
            {create.isError && (
              <Alert severity="error">Заявку не удалось создать. Проверьте, что выбранный модуль закреплен за текущим сотрудником.</Alert>
            )}

            {wizardStep === 0 && (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                <TextField select label="Модуль" value={newRequest.unit_id} onChange={(event) => setNewRequest({ unit_id: event.target.value })} disabled={employeeModules.length === 0} sx={{ minWidth: 320 }}>
                  {employeeModules.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
                </TextField>
                <Button endIcon={<ArrowForwardIcon />} variant="contained" disabled={!newRequest.unit_id} onClick={() => setWizardStep(1)}>
                  Далее
                </Button>
              </Stack>
            )}
            {wizardStep === 1 && (
              <Stack spacing={2}>
                <Paper className="wizard-summary" elevation={0}>
                  <Typography><b>Модуль:</b> {selectedModule?.name}</Typography>
                  <Typography color="text.secondary">Будет создана запись `requests` с полями `id`, `economist_id`, `unit_id`, `sum`, `status`.</Typography>
                </Paper>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" onClick={() => setWizardStep(0)}>Назад</Button>
                  <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={create.isPending}>
                    Создать и перейти к строкам
                  </Button>
                </Stack>
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      <Paper className="surface-pad" elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="Статус" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} sx={{ minWidth: 220 }}>
            <MenuItem value="">Все</MenuItem>
            {Object.entries(requestStatusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField select label="Модуль" value={filters.unit_id} onChange={(event) => setFilters({ ...filters, unit_id: event.target.value })} sx={{ minWidth: 260 }}>
            <MenuItem value="">Все</MenuItem>
            {allModules.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>

      <Paper className="table-surface" elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Модуль</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>План</TableCell>
              <TableCell>Утверждено</TableCell>
              <TableCell>Строк</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id} hover onClick={() => navigate(`/requests/${item.id}`)} sx={{ cursor: 'pointer' }} className={item.status === 'fixed' ? 'fixed-request' : ''}>
                <TableCell>{units.find((unit) => unit.id === item.unit_id)?.name || item.unit_id}</TableCell>
                <TableCell><RequestStatusBadge status={item.status} /></TableCell>
                <TableCell>{money(item.summary?.planned_sum)}</TableCell>
                <TableCell>{money(item.summary?.approved_sum ?? item.sum)}</TableCell>
                <TableCell>{item.summary?.items_count || 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
