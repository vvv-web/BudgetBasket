import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { User } from '../types';
import { money } from '../utils/labels';

type Breakdown = {
  id: string;
  name: string;
  kind: 'dds' | 'invest' | 'unit';
  planned: number;
  approved: number;
  items_count: number;
};

type DashboardData = {
  scope: { unit_id: string | null; available_units: { id: string; name: string; parent_id: string | null }[] };
  totals: {
    planned: number;
    approved: number;
    remaining: number;
    requests_count: number;
    approved_requests_count: number;
    review_requests_count: number;
  };
  by_unit: Breakdown[];
  by_category: Breakdown[];
  by_article: Breakdown[];
};

const chartColors = ['#2F6FED', '#20A68A', '#8B5CF6', '#F59E0B', '#EC6A5C', '#3AA6D0'];

function Metric({ title, value, hint, icon, tone = 'blue' }: { title: string; value: string | number; hint: string; icon: React.ReactNode; tone?: string }) {
  return (
    <Card className="metric-card dashboard-metric" elevation={0}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" spacing={1.5}>
          <Box>
            <Typography className="section-label">{title}</Typography>
            <Typography variant="h5" sx={{ mt: 0.65, whiteSpace: 'nowrap' }}>{value}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{hint}</Typography>
          </Box>
          <Box className={`metric-icon metric-icon-${tone}`}>{icon}</Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function DonutChart({ rows, total }: { rows: Breakdown[]; total: number }) {
  const segments = useMemo(() => {
    const chartRows = rows.length > 6
      ? [
          ...rows.slice(0, 5),
          rows.slice(5).reduce<Breakdown>((rest, row) => ({
            ...rest,
            planned: rest.planned + row.planned,
            approved: rest.approved + row.approved,
            items_count: rest.items_count + row.items_count,
          }), { id: 'other', name: 'Остальные категории', kind: 'dds', planned: 0, approved: 0, items_count: 0 }),
        ]
      : rows;
    let offset = 0;
    return chartRows.map((row, index) => {
      const percentage = total ? (row.planned / total) * 100 : 0;
      const result = { ...row, percentage, offset, color: chartColors[index] };
      offset += percentage;
      return result;
    });
  }, [rows, total]);

  if (!rows.length) {
    return <Box className="dashboard-empty-chart">Нет данных для распределения</Box>;
  }

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems="center">
      <Box className="dashboard-donut" aria-label="Распределение бюджета по категориям">
        <svg viewBox="0 0 42 42" role="img">
          <circle className="dashboard-donut-track" cx="21" cy="21" r="15.9155" />
          {segments.map((segment) => (
            <circle
              key={segment.id}
              className="dashboard-donut-segment"
              cx="21"
              cy="21"
              r="15.9155"
              stroke={segment.color}
              strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
              strokeDashoffset={-segment.offset}
            />
          ))}
        </svg>
        <Box className="dashboard-donut-value">
          <Typography variant="caption" color="text.secondary">План</Typography>
          <Typography variant="subtitle2">{money(total)}</Typography>
        </Box>
      </Box>
      <Stack spacing={1.15} className="dashboard-legend">
        {segments.map((segment) => (
          <Stack key={segment.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={0.9} minWidth={0} alignItems="center">
              <Box className="dashboard-legend-dot" sx={{ backgroundColor: segment.color }} />
              <Typography variant="body2" noWrap title={segment.name}>{segment.name}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{segment.percentage.toFixed(0)}%</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function BudgetBars({ rows, title, emptyText, showType, showAmounts }: { rows: Breakdown[]; title: string; emptyText: string; showType?: boolean; showAmounts?: boolean }) {
  const visibleRows = rows.slice(0, 5);
  const max = Math.max(...visibleRows.map((item) => item.planned), 0);
  return (
    <Card className="surface dashboard-panel" elevation={0}>
      <Box className="dashboard-panel-heading">
        <Typography variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary">План / утверждено</Typography>
      </Box>
      {!visibleRows.length ? (
        <Box className="dashboard-empty-chart">{emptyText}</Box>
      ) : (
        <Stack spacing={2.1}>
          {visibleRows.map((row) => {
            const planned = max ? (row.planned / max) * 100 : 0;
            const approved = row.planned ? (row.approved / row.planned) * 100 : 0;
            return (
              <Box key={row.id}>
                <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="baseline">
                  <Stack direction="row" spacing={0.8} alignItems="center" minWidth={0}>
                    <Typography variant="body2" fontWeight={650} noWrap title={row.name}>{row.name}</Typography>
                    {showType ? (
                      <Chip
                        size="small"
                        label={row.kind === 'invest' ? 'Инвест-проект' : 'Статья ДДС'}
                        className={`dashboard-type-chip dashboard-type-chip-${row.kind}`}
                      />
                    ) : null}
                  </Stack>
                  {showAmounts ? (
                    <Stack className="dashboard-article-amounts" spacing={0.15} alignItems="flex-end">
                      <Typography variant="caption" color="text.secondary">План: {money(row.planned)}</Typography>
                      <Typography variant="caption" color="primary.main" fontWeight={700}>Утверждено: {money(row.approved)}</Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{money(row.planned)}</Typography>
                  )}
                </Stack>
                <Box className="dashboard-bar-track" sx={{ mt: 0.9 }}>
                  <Box className="dashboard-bar-planned" sx={{ width: `${planned}%` }}>
                    <Box className="dashboard-bar-approved" sx={{ width: `${approved}%` }} />
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [unitId, setUnitId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', unitId],
    queryFn: async () => (await api.get<DashboardData>('/dashboard', { params: { unit_id: unitId || undefined } })).data,
  });

  const approvalRate = data?.totals.planned ? Math.round((data.totals.approved / data.totals.planned) * 100) : 0;
  const hasSelectedUnit = Boolean(unitId);
  const scopeLabel = user.role === 'admin' ? 'Вся организация' : 'Только ваша зона ответственности';

  if (isLoading || !data) {
    return <Skeleton variant="rounded" height={420} sx={{ borderRadius: 4 }} />;
  }

  return (
    <Stack spacing={2.5} className="dashboard-page">
      <Card className="dashboard-hero" elevation={0}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" icon={<AccountTreeOutlinedIcon />} label={scopeLabel} className="dashboard-scope-chip" />
            {hasSelectedUnit && <Chip size="small" label="Фокус на подразделении" variant="outlined" />}
          </Stack>
          <Typography variant="h5" sx={{ mt: 1.4 }}>Бюджет в одном взгляде</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.65, maxWidth: 620 }}>
            Контролируйте план, согласования и распределение средств по подразделениям и статьям.
          </Typography>
        </Box>
        <TextField select size="small" label="Подразделение" value={unitId} onChange={(event) => setUnitId(event.target.value)} className="dashboard-unit-filter">
          <MenuItem value="">Все доступные подразделения</MenuItem>
          {data.scope.available_units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
        </TextField>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric title="Плановый бюджет" value={money(data.totals.planned)} hint="По всем статьям" icon={<PaymentsOutlinedIcon fontSize="small" />} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric title="Утверждено" value={money(data.totals.approved)} hint={`${approvalRate}% от плана`} icon={<AssignmentTurnedInIcon fontSize="small" />} tone="green" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric title="На согласовании" value={data.totals.review_requests_count} hint={`из ${data.totals.requests_count} заявок`} icon={<FactCheckIcon fontSize="small" />} tone="amber" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric title="Остаток к решению" value={money(data.totals.remaining)} hint="Не утверждено" icon={<TrendingUpIcon fontSize="small" />} tone="purple" /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card className="surface dashboard-panel dashboard-category-panel" elevation={0}>
            <Box className="dashboard-panel-heading">
              <Box>
                <Typography variant="h6">Структура бюджета</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>По категориям расходов и инвестиций</Typography>
              </Box>
              <PieChartOutlineIcon color="primary" />
            </Box>
            <DonutChart rows={data.by_category} total={data.totals.planned} />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <BudgetBars rows={data.by_unit} title="Подразделения" emptyText="В выбранном подразделении пока нет заявок" />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <BudgetBars rows={data.by_article} title="Ключевые статьи" emptyText="Добавьте статьи в заявки, чтобы увидеть распределение" showType showAmounts />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card className="surface dashboard-panel dashboard-progress-panel" elevation={0}>
            <Box className="dashboard-panel-heading">
              <Typography variant="h6">Статус согласования</Typography>
              <ArrowOutwardIcon color="primary" />
            </Box>
            <Stack spacing={2.25}>
              <Box>
                <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={650}>Исполнение плана</Typography><Typography variant="body2" color="primary.main" fontWeight={700}>{approvalRate}%</Typography></Stack>
                <LinearProgress variant="determinate" value={approvalRate} sx={{ mt: 1, height: 9, borderRadius: 9 }} />
              </Box>
              <Box className="dashboard-status-summary">
                <Box><Typography variant="h6">{data.totals.approved_requests_count}</Typography><Typography variant="body2" color="text.secondary">утверждено</Typography></Box>
                <Box><Typography variant="h6">{data.totals.review_requests_count}</Typography><Typography variant="body2" color="text.secondary">на проверке</Typography></Box>
                <Box><Typography variant="h6">{data.totals.requests_count}</Typography><Typography variant="body2" color="text.secondary">всего заявок</Typography></Box>
              </Box>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
