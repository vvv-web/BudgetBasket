import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { downloadBlob } from '../utils/download';
import type { CatalogItem, Unit } from '../types';

type CatalogKind = 'dds' | 'invests';

type ManualRow = {
  id: string;
  category: string;
  name: string;
  unit_id: string;
  is_active: boolean;
};

const emptyRow = (): ManualRow => ({
  id: crypto.randomUUID(),
  category: '',
  name: '',
  unit_id: '',
  is_active: true,
});

const catalogMeta: Record<CatalogKind, { title: string; path: string; leafLabel: string }> = {
  dds: {
    title: 'Статьи ДДС',
    path: '/catalog/dds',
    leafLabel: 'статья ДДС',
  },
  invests: {
    title: 'Инвест-проекты',
    path: '/catalog/invests',
    leafLabel: 'инвест-проект',
  },
};

function BoxList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CatalogManageDialog({
  open,
  onClose,
  kind,
  units,
  categories,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: CatalogKind;
  units: Unit[];
  categories: CatalogItem[];
  onChanged: () => void;
}) {
  const meta = catalogMeta[kind];
  const departments = units.filter((unit) => unit.type === 'department' || !unit.parent_id);
  const categoryNames = useMemo(() => {
    const names = new Set(categories.map((item) => item.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [categories]);

  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [createResult, setCreateResult] = useState<{ created: number; errors: string[] } | null>(null);

  useEffect(() => {
    if (open) {
      setRows([emptyRow()]);
      setImportResult(null);
      setCreateResult(null);
    }
  }, [open, kind]);

  const updateRow = (id: string, patch: Partial<ManualRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const create = useMutation({
    mutationFn: async () => {
      const prepared = rows.filter((row) => row.name.trim() || row.category.trim());
      if (!prepared.length) {
        throw new Error('Заполните хотя бы одну строку');
      }
      const knownCategories = [...categories];
      const errors: string[] = [];
      let created = 0;
      for (const [index, row] of prepared.entries()) {
        const line = index + 1;
        if (!row.name.trim()) {
          errors.push(`Строка ${line}: укажите название`);
          continue;
        }
        try {
          let parentId: string | null = null;
          if (row.category.trim()) {
            const existing = knownCategories.find(
              (item) => item.name.trim().toLowerCase() === row.category.trim().toLowerCase(),
            );
            if (existing) {
              parentId = existing.id;
            } else {
              const createdCategory = (
                await api.post<CatalogItem>(meta.path, {
                  parent_id: null,
                  unit_id: row.unit_id || null,
                  name: row.category.trim(),
                  is_active: true,
                })
              ).data;
              parentId = createdCategory.id;
              knownCategories.push(createdCategory);
            }
          }
          await api.post(meta.path, {
            parent_id: parentId,
            unit_id: row.unit_id || null,
            name: row.name.trim(),
            is_active: row.is_active,
          });
          created += 1;
        } catch (error) {
          const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          errors.push(`Строка ${line}: ${detail || 'не удалось сохранить'}`);
        }
      }
      return { created, errors };
    },
    onSuccess: (result) => {
      setCreateResult(result);
      if (result.created > 0) {
        setRows([emptyRow()]);
        onChanged();
      }
    },
  });

  const downloadTemplate = async () => {
    const response = await api.get(`/catalog/${kind}/import-template`, { responseType: 'blob' });
    downloadBlob(response.data, `nsi_${kind}_template.xlsx`);
  };

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return (await api.post<{ created: number; updated: number; errors: string[] }>(`/catalog/${kind}/import`, body)).data;
    },
    onSuccess: (result) => {
      setImportResult(result);
      onChanged();
    },
  });

  const handleClose = () => {
    setImportResult(null);
    setCreateResult(null);
    onClose();
  };

  const cellFieldSx = {
    '& .MuiOutlinedInput-root': { bgcolor: '#fff' },
    '& .MuiInputBase-input': { py: 1, fontSize: 14 },
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6, flexWrap: 'wrap' }}>
        <Typography component="span" variant="h6" sx={{ flex: 1, minWidth: 180, fontWeight: 700 }}>
          Управление НСИ · {meta.title}
        </Typography>
        <Stack direction="row" spacing={1} className="page-actions" sx={{ mr: 4 }}>
          <Button startIcon={<DownloadIcon />} variant="outlined" onClick={downloadTemplate}>
            Скачать шаблон
          </Button>
          <Button component="label" startIcon={<UploadFileIcon />} variant="contained" disabled={importFile.isPending}>
            Загрузить Excel
            <input
              hidden
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile.mutate(file);
                event.target.value = '';
              }}
            />
          </Button>
        </Stack>
        <IconButton onClick={handleClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {importResult && (
            <Alert severity={importResult.errors.length ? 'warning' : 'success'}>
              Импортировано: создано {importResult.created}, обновлено {importResult.updated}
              {importResult.errors.length > 0 && <BoxList items={importResult.errors.slice(0, 5)} />}
            </Alert>
          )}

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Создать вручную</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
              Таблица как в Excel: категория → название ({meta.leafLabel}). Строка без указанной категории считается самой категорией.
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '8px', overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                    <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Категория</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Название</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Подразделение</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>Активен</TableCell>
                    <TableCell sx={{ width: 56 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Autocomplete
                          freeSolo
                          options={categoryNames}
                          value={row.category}
                          onInputChange={(_, value) => updateRow(row.id, { category: value })}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              size="small"
                              placeholder="Категория"
                              sx={cellFieldSx}
                            />
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          placeholder={meta.leafLabel}
                          value={row.name}
                          onChange={(event) => updateRow(row.id, { name: event.target.value })}
                          fullWidth
                          sx={cellFieldSx}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={row.unit_id}
                          onChange={(event) => updateRow(row.id, { unit_id: event.target.value })}
                          fullWidth
                          sx={cellFieldSx}
                          SelectProps={{ displayEmpty: true }}
                        >
                          <MenuItem value="">По умолчанию</MenuItem>
                          {departments.map((unit) => (
                            <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={row.is_active ? 'да' : 'нет'}
                          onChange={(event) => updateRow(row.id, { is_active: event.target.value === 'да' })}
                          fullWidth
                          sx={cellFieldSx}
                        >
                          <MenuItem value="да">да</MenuItem>
                          <MenuItem value="нет">нет</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          disabled={rows.length === 1}
                          onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5 }}>
              <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
                Добавить строку
              </Button>
              <Button
                startIcon={<AddIcon />}
                variant="contained"
                onClick={() => create.mutate()}
                disabled={create.isPending || !rows.some((row) => row.name.trim())}
              >
                Сохранить строки
              </Button>
            </Stack>
            {create.isError && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {(create.error as Error)?.message || 'Не удалось сохранить строки'}
              </Alert>
            )}
            {createResult && (
              <Alert severity={createResult.errors.length ? 'warning' : 'success'} sx={{ mt: 1.5 }}>
                Создано записей: {createResult.created}
                {createResult.errors.length > 0 && <BoxList items={createResult.errors.slice(0, 5)} />}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

function CatalogPanel({
  kind,
  units,
  dialogOpen,
  onDialogOpenChange,
}: {
  kind: CatalogKind;
  units: Unit[];
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
}) {
  const meta = catalogMeta[kind];
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: [meta.path],
    queryFn: async () => (await api.get<CatalogItem[]>(meta.path)).data,
  });

  const categories = useMemo(() => data.filter((item) => !item.parent_id && item.is_active), [data]);
  const sorted = useMemo(() => {
    const byParent = new Map<string | null, CatalogItem[]>();
    for (const item of data) {
      const key = item.parent_id;
      const list = byParent.get(key) || [];
      list.push(item);
      byParent.set(key, list);
    }
    const roots = byParent.get(null) || [];
    const rows: CatalogItem[] = [];
    for (const root of roots) {
      rows.push(root);
      rows.push(...(byParent.get(root.id) || []));
    }
    for (const item of data) {
      if (item.parent_id && !data.some((entry) => entry.id === item.parent_id) && !rows.includes(item)) {
        rows.push(item);
      }
    }
    return rows;
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [meta.path] });

  return (
    <Stack spacing={2.5}>
      <Paper className="table-surface">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Тип</TableCell>
              <TableCell>Название</TableCell>
              <TableCell>Категория</TableCell>
              <TableCell>Подразделение</TableCell>
              <TableCell>Активно</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((item) => {
              const isCategory = !item.parent_id;
              const parent = data.find((entry) => entry.id === item.parent_id);
              return (
                <TableRow key={item.id} hover sx={{ bgcolor: isCategory ? 'rgba(47, 111, 237, 0.04)' : undefined }}>
                  <TableCell>
                    <Chip
                      size="small"
                      label={isCategory ? 'Категория' : meta.leafLabel}
                      sx={{
                        bgcolor: isCategory ? '#EAF1FF' : '#F3F4F6',
                        color: isCategory ? '#2F6FED' : '#6B7280',
                        fontWeight: 600,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: isCategory ? 700 : 500, pl: isCategory ? 1 : 3 }}>{item.name}</TableCell>
                  <TableCell>{parent?.name || '—'}</TableCell>
                  <TableCell>{units.find((unit) => unit.id === item.unit_id)?.name || item.unit_id || '—'}</TableCell>
                  <TableCell>{item.is_active ? 'Да' : 'Нет'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <CatalogManageDialog
        open={dialogOpen}
        onClose={() => onDialogOpenChange(false)}
        kind={kind}
        units={units}
        categories={categories}
        onChanged={refresh}
      />
    </Stack>
  );
}

export default function CatalogsPage() {
  const [tab, setTab] = useState<CatalogKind>('dds');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get<Unit[]>('/units')).data,
  });

  return (
    <Stack spacing={3}>
      <Paper className="surface-pad" sx={{ py: 0, px: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1.5}>
          <Tabs value={tab} onChange={(_, value: CatalogKind) => setTab(value)} sx={{ minHeight: 56 }}>
            <Tab value="dds" label="Статьи ДДС" />
            <Tab value="invests" label="Инвест-проекты" />
          </Tabs>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)} sx={{ mb: { sm: 0.5 } }}>
            Добавить / импорт
          </Button>
        </Stack>
      </Paper>
      <CatalogPanel kind={tab} units={units} dialogOpen={dialogOpen} onDialogOpenChange={setDialogOpen} />
    </Stack>
  );
}
