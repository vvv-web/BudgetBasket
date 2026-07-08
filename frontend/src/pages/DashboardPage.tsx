import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FolderIcon from '@mui/icons-material/Folder';
import PaymentsIcon from '@mui/icons-material/Payments';
import Box from '@mui/material/Box';
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
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box className="metric-icon">{icon}</Box>
          <div>
            <Typography className="section-label">{title}</Typography>
            <Typography variant="h5" sx={{ mt: 0.5 }}>{value}</Typography>
          </div>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const { data = [] } = useQuery({ queryKey: ['requests'], queryFn: async () => (await api.get<BudgetRequest[]>('/requests')).data });
  const review = data.filter((item) => item.status === 'on_review').length;
  const closed = data.filter((item) => ['approved', 'partially_approved', 'rejected'].includes(item.status)).length;
  const approved = data.reduce((sum, item) => sum + (item.summary?.approved_sum || item.sum || 0), 0);

  return (
    <Stack spacing={3}>
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Всего заявок" value={data.length} icon={<FolderIcon fontSize="small" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="На рассмотрении" value={review} icon={<FactCheckIcon fontSize="small" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Закрыто" value={closed} icon={<AssignmentTurnedInIcon fontSize="small" />} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <Metric title="Утверждённый бюджет" value={money(approved)} icon={<PaymentsIcon fontSize="small" />} />
        </Grid>
      </Grid>
    </Stack>
  );
}
