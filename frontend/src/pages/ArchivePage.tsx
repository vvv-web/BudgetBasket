import ArchiveIcon from '@mui/icons-material/Archive';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetRequest } from '../types';
import { money } from '../utils/labels';

export default function ArchivePage() {
  const [year, setYear] = useState(2026);
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['archive', year], queryFn: async () => (await api.get<BudgetRequest[]>(`/archive/${year}/requests`)).data });
  const archive = useMutation({ mutationFn: () => api.post(`/admin/archive-year/${year}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['archive', year] }) });

  return (
    <Stack spacing={3}>
      <Paper className="surface-pad" elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <TextField label="Год" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <Button startIcon={<ArchiveIcon />} variant="contained" onClick={() => archive.mutate()}>Архивировать год</Button>
        </Stack>
      </Paper>
      <Paper className="table-surface" elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Год</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Утверждено</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((request) => (
              <TableRow key={request.id} hover>
                <TableCell>{request.id}</TableCell>
                <TableCell>{year}</TableCell>
                <TableCell><RequestStatusBadge status={request.status} /></TableCell>
                <TableCell>{money(request.sum)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
