import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
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

type CategoryRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type CatalogDraft = {
  parent_id: string;
  unit_id: string;
  name: string;
  is_active: boolean;
};

type ImportRow = {
  row: number;
  category: string | null;
  name: string;
  unit_id: string | null;
  unit_name: string;
  is_active: boolean;
  action?: 'create' | 'update';
};

type ImportResult = {
  preview: boolean;
  created: number;
  updated: number;
  errors: string[];
  rows: ImportRow[];
};

const emptyRow = (): ManualRow => ({
  id: crypto.randomUUID(),
  category: '',
  name: '',
  unit_id: '',
  is_active: true,
});

const emptyCategoryRow = (): CategoryRow => ({
  id: crypto.randomUUID(),
  name: '',
  is_active: true,
});

const emptyDraft = (): CatalogDraft => ({
  parent_id: '',
  unit_id: '',
  name: '',
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

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || (error instanceof Error ? error.message : fallback);
}

function CatalogManageDialog({
  open,
  onClose,
  kind,
  units,
  items,
  categories,
  departmentId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: CatalogKind;
  units: Unit[];
  items: CatalogItem[];
  categories: CatalogItem[];
  departmentId: string;
  onChanged: () => void;
}) {
  const toast = useAppToast();
  const meta = catalogMeta[kind];
  const departments = units.filter((unit) => unit.type === 'department' || !unit.parent_id);

  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>([]);
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const [createResult, setCreateResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  const categoryNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of categories) {
      const key = item.name.trim().toLowerCase();
      if (key) names.set(key, item.name.trim());
    }
    for (const row of categoryRows) {
      const key = row.name.trim().toLowerCase();
      if (key) names.set(key, row.name.trim());
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [categories, categoryRows]);

  useEffect(() => {
    if (open) {
      setRows([{ ...emptyRow(), unit_id: departmentId }]);
      setCategoryRows([]);
      setImportPreview(null);
      setCreateResult(null);
    }
  }, [open, kind, departmentId]);

  const updateRow = (id: string, patch: Partial<ManualRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateCategoryRow = (id: string, patch: Partial<CategoryRow>) => {
    setCategoryRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const create = useMutation({
    mutationFn: async () => {
      const prepared = rows.filter((row) => row.name.trim() || row.category.trim());
      const preparedCategories = categoryRows.filter((row) => row.name.trim());
      if (!prepared.length && !preparedCategories.length) {
        throw new Error('Заполните хотя бы одну строку');
      }
      const errors: string[] = [];
      let created = 0;
      let updated = 0;
      const catalogItems = [...items];
      const categoryIdByName = new Map<string, string>();
      const findRootCategory = (name: string) =>
        catalogItems.find(
          (item) =>
            !item.parent_id &&
            item.unit_id === departmentId &&
            item.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
      const findLeaf = (name: string, parentId: string | null) =>
        catalogItems.find(
          (item) =>
            item.parent_id === parentId &&
            item.unit_id === departmentId &&
            item.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
      for (const item of catalogItems) {
        if (!item.parent_id && item.unit_id === departmentId) {
          categoryIdByName.set(item.name.trim().toLowerCase(), item.id);
        }
      }
      for (const categoryRow of preparedCategories) {
        const name = categoryRow.name.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const existing = findRootCategory(name);
        if (existing) {
          categoryIdByName.set(key, existing.id);
          continue;
        }
        const createdCategory = await api.post<CatalogItem>(meta.path, {
          parent_id: null,
          unit_id: departmentId,
          name,
          is_active: categoryRow.is_active,
        });
        catalogItems.push(createdCategory.data);
        categoryIdByName.set(key, createdCategory.data.id);
        created += 1;
      }
      for (const [index, row] of prepared.entries()) {
        const line = index + 1;
        if (!row.name.trim()) {
          errors.push(`Строка ${line}: укажите название`);
          continue;
        }
        try {
          let parentId: string | null = null;
          if (row.category.trim()) {
            const categoryId = categoryIdByName.get(row.category.trim().toLowerCase());
            if (!categoryId) {
              errors.push(`Строка ${line}: сначала добавьте категорию «${row.category.trim()}» в отдельном блоке`);
              continue;
            }
            parentId = categoryId;
          }
          const existing = findLeaf(row.name.trim(), parentId);
          if (existing) {
            await api.patch(`${meta.path}/${existing.id}`, {
              parent_id: parentId,
              unit_id: departmentId,
              name: row.name.trim(),
              is_active: row.is_active,
            });
            updated += 1;
          } else {
            const createdItem = await api.post<CatalogItem>(meta.path, {
              parent_id: parentId,
              unit_id: departmentId,
              name: row.name.trim(),
              is_active: row.is_active,
            });
            catalogItems.push(createdItem.data);
            created += 1;
          }
        } catch (error) {
          errors.push(`Строка ${line}: ${getErrorMessage(error, 'не удалось сохранить')}`);
        }
      }
      return { created, updated, errors };
    },
    onSuccess: (result) => {
      setCreateResult(result);
      if (result.created > 0 || result.updated > 0) {
        toast(`Сохранено: создано ${result.created}, обновлено ${result.updated}`, 'success');
        setRows([emptyRow()]);
        setCategoryRows([]);
        onChanged();
      }
      if (result.errors.length > 0) {
        toast(`Не удалось создать ${result.errors.length} строк`, 'warning');
      }
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить строки'), 'error');
    },
  });

  const downloadTemplate = async () => {
    const response = await api.get(`/catalog/${kind}/import-template`, { responseType: 'blob' });
    downloadBlob(response.data, `nsi_${kind}_template.xlsx`);
  };

  const previewImport = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return (await api.post<ImportResult>(`/catalog/${kind}/import`, body, { params: { preview: true } })).data;
    },
    onSuccess: (result) => {
      const existingCategoryKeys = new Set(categories.map((item) => item.name.trim().toLowerCase()));
      const importedCategoryNames = new Map<string, string>();
      for (const row of result.rows) {
        const categoryName = row.category?.trim();
        if (!categoryName) continue;
        const key = categoryName.toLowerCase();
        if (existingCategoryKeys.has(key)) continue;
        if (!importedCategoryNames.has(key)) {
          importedCategoryNames.set(key, categoryName);
        }
      }
      setCategoryRows(
        [...importedCategoryNames.values()].map((name) => ({
          id: crypto.randomUUID(),
          name,
          is_active: true,
        })),
      );
      const importedRows = result.rows.map((row) => ({
        id: crypto.randomUUID(),
        category: row.category || '',
        name: row.name,
        unit_id: row.unit_id || departmentId,
        is_active: row.is_active,
      }));
      setImportPreview(result);
      setRows(importedRows.length ? importedRows : [{ ...emptyRow(), unit_id: departmentId }]);
      setCreateResult(null);
      toast(
        result.errors.length
          ? 'Импорт загружен с ошибками. Проверьте строки ниже и исправьте данные.'
          : 'Импорт загружен. Проверьте строки ниже и сохраните их.',
        result.errors.length ? 'warning' : 'info',
      );
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось загрузить файл'), 'error');
    },
  });

  const handleClose = () => {
    setImportPreview(null);
    setRows([{ ...emptyRow(), unit_id: departmentId }]);
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
          <Button component="label" startIcon={<UploadFileIcon />} variant="contained" disabled={previewImport.isPending}>
            Импорт
            <input
              hidden
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setImportPreview(null);
                  previewImport.mutate(file);
                }
                event.target.value = '';
              }}
            />
          </Button>
        </Stack>
        <IconButton onClick={handleClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CancelIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {importPreview && (
            <Alert severity={importPreview.errors.length ? 'warning' : 'info'}>
              Импорт завершён: новые категории вынесены отдельно, а в таблицу ниже подставлено {importPreview.rows.length} строк.
              {importPreview.errors.length > 0 && <BoxList items={importPreview.errors.slice(0, 8)} />}
            </Alert>
          )}

          {categoryRows.length > 0 && (
            <Box>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
                Новые категории
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
                Сначала сохраните категории здесь, а затем проверьте строки ниже.
              </Typography>
              <TableContainer component={Paper} variant="outlined" className="catalog-manual-table" sx={{ borderRadius: '8px', overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                      <TableCell sx={{ fontWeight: 700, minWidth: 260 }}>Категория</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 120 }}>Активен</TableCell>
                      <TableCell sx={{ width: 56 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {categoryRows.map((row) => (
                      <TableRow key={row.id} hover>
                        <TableCell>
                          <TextField
                            size="small"
                            value={row.name}
                            onChange={(event) => updateCategoryRow(row.id, { name: event.target.value })}
                            placeholder="Название категории"
                            fullWidth
                            sx={cellFieldSx}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={row.is_active ? 'да' : 'нет'}
                            onChange={(event) => updateCategoryRow(row.id, { is_active: event.target.value === 'да' })}
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
                            disabled={categoryRows.length === 1}
                            onClick={() => setCategoryRows((prev) => prev.filter((item) => item.id !== row.id))}
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
                <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setCategoryRows((prev) => [...prev, emptyCategoryRow()])}>
                  Добавить категорию
                </Button>
              </Stack>
            </Box>
          )}

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Статьи / подкатегории</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
              Таблица как в Excel: категория → название ({meta.leafLabel}). Строки из импорта попадают сюда, а новые категории указываются отдельно выше.
            </Typography>
            <TableContainer component={Paper} variant="outlined" className="catalog-manual-table" sx={{ borderRadius: '8px', overflow: 'auto' }}>
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
                          options={categoryNames}
                          value={row.category || null}
                          onChange={(_, value) => updateRow(row.id, { category: value || '' })}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              size="small"
                              placeholder="Выберите категорию"
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
                          value={departmentId}
                          fullWidth
                          sx={cellFieldSx}
                          SelectProps={{ displayEmpty: true }}
                        >
                          {departments.filter((unit) => unit.id === departmentId).map((unit) => (
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
            </Stack>
            {create.isError && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {getErrorMessage(create.error, 'Не удалось сохранить строки')}
              </Alert>
            )}
            {createResult && (
              <Alert severity={createResult.errors.length ? 'warning' : 'success'} sx={{ mt: 1.5 }}>
                Создано: {createResult.created}, обновлено: {createResult.updated}
                {createResult.errors.length > 0 && <BoxList items={createResult.errors.slice(0, 5)} />}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          startIcon={<SaveOutlinedIcon />}
          variant="outlined"
          onClick={() => create.mutate()}
          disabled={create.isPending || (!rows.some((row) => row.name.trim()) && !categoryRows.some((row) => row.name.trim()))}
        >
          Сохранить строки
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CatalogCellText({
  editing,
  value,
  onChange,
  placeholder,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  if (!editing) {
    return <>{value || '—'}</>;
  }
  return <TextField size="small" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} fullWidth />;
}

function CatalogPanel({
  kind,
  units,
  departmentId,
  dialogOpen,
  onDialogOpenChange,
}: {
  kind: CatalogKind;
  units: Unit[];
  departmentId: string;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
}) {
  const toast = useAppToast();
  const meta = catalogMeta[kind];
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: [meta.path, departmentId],
    queryFn: async () => (await api.get<CatalogItem[]>(meta.path, { params: { unit_id: departmentId || undefined } })).data,
  });

  const rootCategories = useMemo(() => data.filter((item) => !item.parent_id), [data]);
  const departments = useMemo(() => units.filter((unit) => unit.type === 'department' || !unit.parent_id), [units]);
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogDraft>(emptyDraft());
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [meta.path] });

  const startEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setDraft({
      parent_id: item.parent_id || '',
      unit_id: item.unit_id || '',
      name: item.name,
      is_active: item.is_active,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const saveItem = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CatalogDraft }) =>
      api.patch(`${meta.path}/${id}`, {
        parent_id: body.parent_id || null,
        unit_id: body.unit_id || null,
        name: body.name.trim(),
        is_active: body.is_active,
      }),
    onSuccess: () => {
      toast('Изменения сохранены', 'success');
      cancelEdit();
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить изменения'), 'error');
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`${meta.path}/${id}`),
    onSuccess: (_data, deletedId) => {
      toast('Запись удалена', 'success');
      if (editingId === deletedId) {
        cancelEdit();
      }
      setDeleteTarget(null);
      refresh();
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить запись'), 'error');
    },
  });

  return (
    <Stack spacing={2.5}>
      <TableContainer component={Paper} className="table-surface">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Тип</TableCell>
              <TableCell>Название</TableCell>
              <TableCell>Категория</TableCell>
              <TableCell>Подразделение</TableCell>
              <TableCell>Активно</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((item) => {
              const isCategory = !item.parent_id;
              const parent = data.find((entry) => entry.id === item.parent_id);
              const editing = editingId === item.id;
              const parentOptions = rootCategories.filter((category) => category.id !== item.id);
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
                  <TableCell sx={{ fontWeight: isCategory ? 700 : 500, minWidth: 220 }}>
                    <CatalogCellText
                      editing={editing}
                      value={editing ? draft.name : item.name}
                      onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    {editing ? (
                      <TextField
                        select
                        size="small"
                        value={draft.parent_id}
                        onChange={(event) => setDraft((prev) => ({ ...prev, parent_id: event.target.value }))}
                        fullWidth
                      >
                        <MenuItem value="">Без категории</MenuItem>
                        {parentOptions.map((category) => (
                          <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      parent?.name || '—'
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    {editing ? (
                      <TextField
                        select
                        size="small"
                        value={draft.unit_id}
                        onChange={(event) => setDraft((prev) => ({ ...prev, unit_id: event.target.value }))}
                        fullWidth
                      >
                        <MenuItem value="">—</MenuItem>
                        {departments.map((unit) => (
                          <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      units.find((unit) => unit.id === item.unit_id)?.name || item.unit_id || '—'
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    {editing ? (
                      <TextField
                        select
                        size="small"
                        value={draft.is_active ? 'yes' : 'no'}
                        onChange={(event) => setDraft((prev) => ({ ...prev, is_active: event.target.value === 'yes' }))}
                        fullWidth
                      >
                        <MenuItem value="yes">Да</MenuItem>
                        <MenuItem value="no">Нет</MenuItem>
                      </TextField>
                    ) : (
                      item.is_active ? 'Да' : 'Нет'
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ minWidth: 140 }}>
                    {editing ? (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Сохранить">
                          <span>
                            <IconButton
                              color="primary"
                              onClick={() => saveItem.mutate({ id: item.id, body: draft })}
                              disabled={!draft.name.trim() || saveItem.isPending}
                              aria-label="Сохранить"
                            >
                              <CheckIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Отменить">
                          <span>
                            <IconButton onClick={cancelEdit} disabled={saveItem.isPending} aria-label="Отменить">
                              <CancelIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Редактировать">
                          <span>
                            <IconButton onClick={() => startEdit(item)} aria-label="Редактировать запись">
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Удалить">
                          <span>
                            <IconButton onClick={() => setDeleteTarget(item)} aria-label="Удалить запись">
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <CatalogManageDialog
        open={dialogOpen}
        onClose={() => onDialogOpenChange(false)}
        kind={kind}
        units={units}
        items={data}
        categories={rootCategories}
        departmentId={departmentId}
        onChanged={refresh}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Удалить ${deleteTarget && !deleteTarget.parent_id ? 'категорию' : meta.leafLabel}?`}
        description={`Запись «${deleteTarget?.name || ''}» будет удалена. Это действие нельзя отменить.`}
        pending={deleteItem.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteItem.mutate(deleteTarget.id);
        }}
      />
    </Stack>
  );
}

export default function CatalogsPage() {
  const [tab, setTab] = useState<CatalogKind>('dds');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get<Unit[]>('/units')).data,
  });
  const departments = useMemo(() => units.filter((unit) => unit.type === 'department' || !unit.parent_id), [units]);

  useEffect(() => {
    if (!departmentId && departments.length) setDepartmentId(departments[0].id);
  }, [departmentId, departments]);

  return (
    <Stack spacing={3}>
      <Paper className="surface-pad" sx={{ py: { xs: 1, md: 0 }, px: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" spacing={1.5}>
          <Tabs value={tab} onChange={(_, value: CatalogKind) => setTab(value)} sx={{ minHeight: 56 }}>
            <Tab value="dds" label="Статьи ДДС" />
            <Tab value="invests" label="Инвест-проекты" />
          </Tabs>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField select size="small" label="Подразделение" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} sx={{ minWidth: 280 }}>
              {departments.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
            </TextField>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)} disabled={!departmentId}>
              Добавить / импорт
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <CatalogPanel kind={tab} units={units} departmentId={departmentId} dialogOpen={dialogOpen} onDialogOpenChange={setDialogOpen} />
    </Stack>
  );
}
