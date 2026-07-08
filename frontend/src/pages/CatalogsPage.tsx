import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { CatalogItem } from '../types';

function CatalogBlock({ title, path }: { title: string; path: string }) {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: [path], queryFn: async () => (await api.get<CatalogItem[]>(path)).data });
  const [form, setForm] = useState({ name: '' });
  const create = useMutation({
    mutationFn: () => api.post(path, { parent_id: null, name: form.name, is_active: true }),
    onSuccess: () => {
      setForm({ name: '' });
      queryClient.invalidateQueries({ queryKey: [path] });
    },
  });

  return (
    <Paper className="surface-pad" elevation={0}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary">Поля соответствуют data-схеме: id, parent_id, unit_id, name, is_active.</Typography>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField label="Название" value={form.name} onChange={(event) => setForm({ name: event.target.value })} />
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={!form.name}>Добавить</Button>
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Название</TableCell>
            <TableCell>Unit ID</TableCell>
            <TableCell>Родитель</TableCell>
            <TableCell>Активно</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.name}</TableCell>
              <TableCell>{item.unit_id || '—'}</TableCell>
              <TableCell>{item.parent_id || '—'}</TableCell>
              <TableCell>{item.is_active ? 'Да' : 'Нет'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export default function CatalogsPage() {
  return (
    <Stack spacing={3}>
      <div>
        <Typography className="page-title">Справочники</Typography>
        <Typography className="page-subtitle">Управление таблицами `dds_catalog` и `invests_catalog` из JSON-хранилища.</Typography>
      </div>
      <CatalogBlock title="ДДС" path="/catalog/dds" />
      <CatalogBlock title="Инвест-проекты" path="/catalog/invests" />
    </Stack>
  );
}
