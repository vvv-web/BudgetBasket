import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FolderIcon from '@mui/icons-material/Folder';
import PaymentsIcon from '@mui/icons-material/Payments';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BudgetRequest, User } from '../types';
import { money } from '../utils/labels';

function Metric({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="metric-card" elevation={0}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          {icon}
          <div>
            <Typography color="text.secondary">{title}</Typography>
            <Typography variant="h5">{value}</Typography>
          </div>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const { data = [] } = useQuery({ queryKey: ['requests'], queryFn: async () => (await api.get<BudgetRequest[]>('/requests')).data });
  const review = data.filter((item) => item.status === 'submitted' || item.status === 'in_review').length;
  const fixed = data.filter((item) => item.status === 'fixed').length;
  const approved = data.reduce((sum, item) => sum + (item.summary?.approved_sum || item.sum || 0), 0);

  return (
    <Stack spacing={3}>
      <div>
        <Typography className="page-title">Сводка</Typography>
        <Typography className="page-subtitle">Текущая роль: {user.role}</Typography>
      </div>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Всего заявок" value={data.length} icon={<FolderIcon color="primary" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="На рассмотрении" value={review} icon={<FactCheckIcon color="warning" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Зафиксировано" value={fixed} icon={<AssignmentTurnedInIcon color="success" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Утвержденный бюджет" value={money(approved)} icon={<PaymentsIcon color="action" />} />
        </Grid>
      </Grid>
    </Stack>
  );
}
