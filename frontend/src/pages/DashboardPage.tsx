import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
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
import Tooltip from '@mui/material/Tooltip';
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
    frozen: number;
    remaining: number;
    requests_count: number;
    approved_requests_count: number;
    review_requests_count: number;
    frozen_requests_count: number;
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

function DonutChart({ rows, total, ariaLabel }: { rows: Breakdown[]; total: number; ariaLabel: string }) {
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

  const pointOnCircle = (radius: number, angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return {
      x: 21 + radius * Math.cos(radians),
      y: 21 + radius * Math.sin(radians),
    };
  };

  const segmentPath = (startPercentage: number, percentage: number) => {
    const startAngle = startPercentage * 3.6 - 90;
    const endAngle = (startPercentage + percentage) * 3.6 - 90;
    const outerStart = pointOnCircle(19, startAngle);
    const outerEnd = pointOnCircle(19, endAngle);
    const innerStart = pointOnCircle(11, startAngle);
    const innerEnd = pointOnCircle(11, endAngle);
    const largeArc = percentage > 50 ? 1 : 0;

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A 19 19 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A 11 11 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      'Z',
    ].join(' ');
  };

  if (!rows.length) {
    return <Box className="dashboard-empty-chart">Нет данных для расчета</Box>;
  }

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems="center">
      <Box className="dashboard-donut" aria-label={ariaLabel}>
        <svg viewBox="0 0 42 42" role="img">
          <circle className="dashboard-donut-track" cx="21" cy="21" r="15" />
          {segments.map((segment) => (
            <Tooltip
              key={segment.id}
              arrow
              placement="top"
              classes={{ popper: 'dashboard-donut-tooltip' }}
              title={(
                <Box>
                  <Typography variant="caption" component="div">{segment.name}</Typography>
                  <Typography variant="body2" component="div" fontWeight={700}>{money(segment.planned)}</Typography>
                </Box>
              )}
            >
              {segment.percentage >= 99.999 ? (
                <circle
                  className="dashboard-donut-segment"
                  cx="21"
                  cy="21"
                  r="15"
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="8"
                  tabIndex={0}
                />
              ) : (
                <path
                  className="dashboard-donut-segment"
                  d={segmentPath(segment.offset, segment.percentage)}
                  fill={segment.color}
                  tabIndex={0}
                />
              )}
            </Tooltip>
          ))}
        </svg>
        <Box className="dashboard-donut-value">
          <Typography variant="caption" color="text.secondary">Расчет</Typography>
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
  const scaleMax = Math.max(...visibleRows.map((item) => Math.max(item.planned, item.approved)), 0);

  return (
    <Card className="surface dashboard-panel" elevation={0}>
      <Box className="dashboard-panel-heading">
        <Typography variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary">Расчет / утверждено</Typography>
      </Box>
      {!visibleRows.length ? (
        <Box className="dashboard-empty-chart">{emptyText}</Box>
      ) : (
        <Stack spacing={2.1}>
          {visibleRows.map((row) => {
            const planned = scaleMax ? (row.planned / scaleMax) * 100 : 0;
            const approved = scaleMax ? (row.approved / scaleMax) * 100 : 0;
            const delta = row.approved - row.planned;
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
                      <Typography variant="caption" color="text.secondary">Расчет: {money(row.planned)}</Typography>
                      <Typography variant="caption" color="primary.main" fontWeight={700}>Утверждено: {money(row.approved)}</Typography>
                      <Typography variant="caption" color={delta >= 0 ? 'success.main' : 'error.main'} fontWeight={700}>
                        Корректировка: {delta >= 0 ? `+${money(delta)}` : money(delta)}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{money(row.planned)}</Typography>
                  )}
                </Stack>
                <Box className="dashboard-bar-track" sx={{ mt: 0.9 }}>
                  <Box className="dashboard-bar-planned" sx={{ width: `${planned}%` }} />
                  <Box className="dashboard-bar-approved" sx={{ width: `${approved}%` }} />
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
  const correction = data ? data.totals.approved - data.totals.planned : 0;
  const correctionLabel = correction === 0 ? 'Без корректировки' : correction > 0 ? 'Сумма увеличена' : 'Сумма уменьшена';

  if (isLoading || !data) {
    return <Skeleton variant="rounded" height={420} sx={{ borderRadius: 4 }} />;
  }

  return (
    <Stack spacing={2.5} className="dashboard-page">
      <Card className="dashboard-hero" elevation={0}>
        <Box>
          <Typography variant="h5">Сводка расчетов</Typography>
        </Box>
        <TextField select size="small" label="Подразделение" value={unitId} onChange={(event) => setUnitId(event.target.value)} className="dashboard-unit-filter">
          <MenuItem value="">Все доступные подразделения</MenuItem>
          {data.scope.available_units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
        </TextField>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 2.4 }}><Metric title="Сумма" value={money(data.totals.planned)} hint="Запланированная модулями" icon={<PaymentsOutlinedIcon fontSize="small" />} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2.4 }}><Metric title="Корректировка" value={correction >= 0 ? `+${money(correction)}` : money(correction)} hint={correctionLabel} icon={<TrendingUpIcon fontSize="small" />} tone="purple" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2.4 }}><Metric title="Утверждено" value={money(data.totals.approved)} hint={`${approvalRate}% от расчета`} icon={<AssignmentTurnedInIcon fontSize="small" />} tone="green" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2.4 }}><Metric title="Зафиксировано" value={money(data.totals.frozen)} hint={`${data.totals.frozen_requests_count} заявок зафиксировано`} icon={<LockOutlinedIcon fontSize="small" />} tone="amber" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 2.4 }}><Metric title="Обработано" value={data.totals.approved_requests_count} hint={`заявок из ${data.totals.requests_count}`} icon={<FactCheckIcon fontSize="small" />} tone="amber" /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card className="surface dashboard-panel dashboard-category-panel" elevation={0}>
            <Box className="dashboard-panel-heading">
              <Box>
                <Typography variant="h6">Структура расчета</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>По категориям модульных сумм и решений экономиста</Typography>
              </Box>
              <PieChartOutlineIcon color="primary" />
            </Box>
            <DonutChart rows={data.by_category} total={data.totals.planned} ariaLabel="Распределение расчетов по категориям" />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card className="surface dashboard-panel" elevation={0}>
            <Box className="dashboard-panel-heading">
              <Box>
                <Typography variant="h6">Подразделения</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>Распределение рассчитанных сумм по подразделениям</Typography>
              </Box>
              <PieChartOutlineIcon color="primary" />
            </Box>
            <DonutChart rows={data.by_unit} total={data.totals.planned} ariaLabel="Распределение расчетов по подразделениям" />
          </Card>
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
                <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={650}>Исполнение расчета</Typography><Typography variant="body2" color="primary.main" fontWeight={700}>{approvalRate}%</Typography></Stack>
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
