import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import { TableColumnHeader, TableColumnTools } from '../components/TableColumnControls';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { downloadBlob } from '../utils/download';
import type { CatalogItem, Unit } from '../types';
import { filterFieldSx } from '../utils/responsive';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';

type CatalogKind = 'dds' | 'invests';
type CatalogTableColumn = 'name' | 'unit' | 'active' | 'actions';

const CATALOG_TABLE_COLUMN_WIDTHS: Record<CatalogTableColumn, number> = {
  name: 260,
  unit: 240,
  active: 140,
  actions: 120,
};

const CATALOG_TABLE_COLUMN_MIN_WIDTHS: Record<CatalogTableColumn, number> = {
  name: 170,
  unit: 160,
  active: 110,
  actions: 90,
};

type ManualRow = {
  id: string;
  name: string;
  unit_id: string;
  is_active: boolean;
};

type ManualTableColumn = 'name' | 'unit' | 'active' | 'actions';

type CatalogDraft = {
  unit_id: string;
  name: string;
  is_active: boolean;
};

type ImportRow = {
  row: number;
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
  name: '',
  unit_id: '',
  is_active: true,
});

const emptyDraft = (): CatalogDraft => ({
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
  if (detail) return detail;
  if (error instanceof Error && error.message === 'Network Error') return 'Не удалось подключиться к серверу';
  return detail || (error instanceof Error ? error.message : fallback);
}

function CatalogManageDialog({
  open,
  onClose,
  kind,
  units,
  items,
  departmentId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: CatalogKind;
  units: Unit[];
  items: CatalogItem[];
  departmentId: string;
  onChanged: () => void;
}) {
  const toast = useAppToast();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const meta = catalogMeta[kind];
  const departments = units.filter((unit) => unit.type === 'department' || !unit.parent_id);

  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const [createResult, setCreateResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  useEffect(() => {
    if (open) {
      setRows([{ ...emptyRow(), unit_id: departmentId }]);
      setImportPreview(null);
      setCreateResult(null);
    }
  }, [open, kind, departmentId]);

  const updateRow = (id: string, patch: Partial<ManualRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const create = useMutation({
    mutationFn: async () => {
      const prepared = rows.filter((row) => row.name.trim());
      if (!prepared.length) {
        throw new Error('Заполните хотя бы одну строку');
      }
      const errors: string[] = [];
      let created = 0;
      let updated = 0;
      const catalogItems = [...items];
      const findArticle = (name: string) =>
        catalogItems.find(
          (item) =>
            item.parent_id === null &&
            item.unit_id === departmentId &&
            item.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
      for (const [index, row] of prepared.entries()) {
        const line = index + 1;
        if (!row.name.trim()) {
          errors.push(`Строка ${line}: укажите название`);
          continue;
        }
        try {
          const existing = findArticle(row.name.trim());
          if (existing) {
            await api.patch(`${meta.path}/${existing.id}`, {
              parent_id: null,
              unit_id: departmentId,
              name: row.name.trim(),
              is_active: row.is_active,
            });
            updated += 1;
          } else {
            const createdItem = await api.post<CatalogItem>(meta.path, {
              parent_id: null,
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
      const importedRows = result.rows.map((row) => ({
        id: crypto.randomUUID(),
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

  /*
  const categoryTableColumns = useMemo<TableColumnDefinition<CategoryRow, CategoryTableColumn>[]>(() => [
    { id: 'name', label: 'Категория', getValue: (row) => row.name },
    {
      id: 'active',
      label: 'Активен',
      getValue: (row) => row.is_active ? 'Да' : 'Нет',
      getSortValue: (row) => row.is_active ? 1 : 0,
    },
    { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  ], []);
  const {
    clearColumnFilter: clearCategoryColumnFilter,
    clearSort: clearCategorySort,
    filterOptions: categoryFilterOptions,
    filterSearchValues: categoryFilterSearchValues,
    hasActiveFilters: hasActiveCategoryFilters,
    resetFilters: resetCategoryFilters,
    resetVisibility: resetCategoryVisibility,
    rows: visibleCategoryRows,
    selectedFilterValues: selectedCategoryFilterValues,
    setAllFilterOptions: setAllCategoryFilterOptions,
    setFilterSearchValue: setCategoryFilterSearchValue,
    setSortAscending: setCategorySortAscending,
    setSortDescending: setCategorySortDescending,
    setVisibleFilterOptions: setCategoryVisibleFilterOptions,
    sort: categorySort,
    toggleFilterOption: toggleCategoryFilterOption,
    toggleVisibility: toggleCategoryVisibility,
    visibility: categoryVisibility,
    visibleColumns: visibleCategoryColumns,
  } = useTableColumnControls({
    rows: categoryRows,
    columns: categoryTableColumns,
  });
  const renderCategoryHeader = (
    columnId: CategoryTableColumn,
    label: string,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={columnId === 'actions' ? 'Действие' : label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={categorySort?.column === columnId ? categorySort.direction : null}
      onSortAscending={() => setCategorySortAscending(columnId)}
      onSortDescending={() => setCategorySortDescending(columnId)}
      onClearSort={() => clearCategorySort(columnId)}
      filterOptions={categoryFilterOptions[columnId]}
      selectedFilterValues={selectedCategoryFilterValues[columnId]}
      filterSearchValue={categoryFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setCategoryFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleCategoryFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllCategoryFilterOptions(columnId)}
      onClearColumnFilter={() => clearCategoryColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setCategoryVisibleFilterOptions(columnId, false)}
    />
  );

  */
  const manualTableColumns = useMemo<TableColumnDefinition<ManualRow, ManualTableColumn>[]>(() => [
    { id: 'name', label: 'Наименование', getValue: (row) => row.name },
    {
      id: 'unit',
      label: 'Объединение',
      getValue: (row) => departments.find((unit) => unit.id === row.unit_id)?.name || row.unit_id || '—',
    },
    {
      id: 'active',
      label: 'Активен',
      getValue: (row) => row.is_active ? 'Да' : 'Нет',
      getSortValue: (row) => row.is_active ? 1 : 0,
    },
    { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  ], [departments]);
  const {
    clearColumnFilter: clearManualColumnFilter,
    clearSort: clearManualSort,
    filterOptions: manualFilterOptions,
    filterSearchValues: manualFilterSearchValues,
    hasActiveFilters: hasActiveManualFilters,
    resetFilters: resetManualFilters,
    resetVisibility: resetManualVisibility,
    rows: visibleManualRows,
    selectedFilterValues: selectedManualFilterValues,
    setAllFilterOptions: setAllManualFilterOptions,
    setFilterSearchValue: setManualFilterSearchValue,
    setSortAscending: setManualSortAscending,
    setSortDescending: setManualSortDescending,
    setVisibleFilterOptions: setManualVisibleFilterOptions,
    sort: manualSort,
    toggleFilterOption: toggleManualFilterOption,
    toggleVisibility: toggleManualVisibility,
    visibility: manualVisibility,
    visibleColumns: visibleManualColumns,
  } = useTableColumnControls({
    rows,
    columns: manualTableColumns,
  });
  const renderManualHeader = (
    columnId: ManualTableColumn,
    label: string,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={columnId === 'actions' ? 'Действие' : label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={manualSort?.column === columnId ? manualSort.direction : null}
      onSortAscending={() => setManualSortAscending(columnId)}
      onSortDescending={() => setManualSortDescending(columnId)}
      onClearSort={() => clearManualSort(columnId)}
      filterOptions={manualFilterOptions[columnId]}
      selectedFilterValues={selectedManualFilterValues[columnId]}
      filterSearchValue={manualFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setManualFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleManualFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllManualFilterOptions(columnId)}
      onClearColumnFilter={() => clearManualColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setManualVisibleFilterOptions(columnId, false)}
    />
  );

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="lg" fullScreen={isMobile}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6, flexWrap: 'wrap' }}>
        <Typography component="span" variant="h6" sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
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
              Импорт завершён: в таблицу ниже подставлено {importPreview.rows.length} строк. Все статьи будут сохранены без родителя.
              {importPreview.errors.length > 0 && <BoxList items={importPreview.errors.slice(0, 8)} />}
            </Alert>
          )}

          {/* Legacy parent/category controls are intentionally hidden; parent_id remains in the schema for future use.
          {categoryRows.length > 0 && (
            <Box>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
                Новые категории
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
                Сначала сохраните категории здесь, а затем проверьте строки ниже.
              </Typography>
              <Stack direction="row" justifyContent="flex-start" sx={{ mb: 1.5 }}>
                <TableColumnTools
                  columns={categoryTableColumns}
                  visibility={categoryVisibility}
                  onToggleColumn={toggleCategoryVisibility}
                  onResetColumns={resetCategoryVisibility}
                  onResetFilters={resetCategoryFilters}
                  hasActiveFilters={hasActiveCategoryFilters}
                />
              </Stack>
              <TableContainer component={Paper} variant="outlined" className="catalog-manual-table" sx={{ borderRadius: '8px', overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                      {categoryVisibility.name && <TableCell sx={{ minWidth: 260 }}>{renderCategoryHeader('name', '\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F')}</TableCell>}
                      {categoryVisibility.active && <TableCell sx={{ width: 120 }}>{renderCategoryHeader('active', '\u0410\u043A\u0442\u0438\u0432\u0435\u043D')}</TableCell>}
                      {categoryVisibility.actions && <TableCell sx={{ width: 56 }}>{renderCategoryHeader('actions', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', { sortable: false, filterable: false })}</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleCategoryRows.map((row) => (
                      <TableRow key={row.id} hover>
                        {categoryVisibility.name && (
                          <TableCell>
                            <TextField
                              size="small"
                              value={row.name}
                              onChange={(event) => updateCategoryRow(row.id, { name: event.target.value })}
                              placeholder="\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438"
                              fullWidth
                              sx={cellFieldSx}
                            />
                          </TableCell>
                        )}
                        {categoryVisibility.active && (
                          <TableCell>
                            <TextField
                              select
                              size="small"
                              value={row.is_active ? '\u0434\u0430' : '\u043D\u0435\u0442'}
                              onChange={(event) => updateCategoryRow(row.id, { is_active: event.target.value === '\u0434\u0430' })}
                              fullWidth
                              sx={cellFieldSx}
                            >
                              <MenuItem value="\u0434\u0430">\u0434\u0430</MenuItem>
                              <MenuItem value="\u043D\u0435\u0442">\u043D\u0435\u0442</MenuItem>
                            </TextField>
                          </TableCell>
                        )}
                        {categoryVisibility.actions && (
                          <TableCell>
                            <IconButton
                              size="small"
                              disabled={categoryRows.length === 1}
                              onClick={() => setCategoryRows((prev) => prev.filter((item) => item.id !== row.id))}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {visibleCategoryRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={visibleCategoryColumns.length} align="center">
                          \u0421\u0442\u0440\u043E\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B
                        </TableCell>
                      </TableRow>
                    )}
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
          */}

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Статьи</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
              Добавьте статьи вручную или импортируйте их из Excel. Родитель для новых статей не задаётся.
            </Typography>
            <Stack direction="row" justifyContent="flex-start" sx={{ mb: 1.5 }}>
              <TableColumnTools
                columns={manualTableColumns}
                visibility={manualVisibility}
                onToggleColumn={toggleManualVisibility}
                onResetColumns={resetManualVisibility}
                onResetFilters={resetManualFilters}
                hasActiveFilters={hasActiveManualFilters}
              />
            </Stack>
            <TableContainer component={Paper} variant="outlined" className="catalog-manual-table" sx={{ borderRadius: '8px', overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                    {manualVisibility.name && <TableCell sx={{ minWidth: 200 }}>{renderManualHeader('name', '\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435')}</TableCell>}
                    {manualVisibility.unit && <TableCell sx={{ minWidth: 200 }}>{renderManualHeader('unit', '\u041F\u043E\u0434\u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u0435')}</TableCell>}
                    {manualVisibility.active && <TableCell sx={{ width: 120 }}>{renderManualHeader('active', '\u0410\u043A\u0442\u0438\u0432\u0435\u043D')}</TableCell>}
                    {manualVisibility.actions && <TableCell sx={{ width: 56 }}>{renderManualHeader('actions', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', { sortable: false, filterable: false })}</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleManualRows.map((row) => (
                    <TableRow key={row.id} hover>
                      {manualVisibility.name && (
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
                      )}
                      {manualVisibility.unit && (
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
                      )}
                      {manualVisibility.active && (
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={row.is_active ? '\u0434\u0430' : '\u043D\u0435\u0442'}
                            onChange={(event) => updateRow(row.id, { is_active: event.target.value === '\u0434\u0430' })}
                            fullWidth
                            sx={cellFieldSx}
                          >
                            <MenuItem value="\u0434\u0430">\u0434\u0430</MenuItem>
                            <MenuItem value="\u043D\u0435\u0442">\u043D\u0435\u0442</MenuItem>
                          </TextField>
                        </TableCell>
                      )}
                      {manualVisibility.actions && (
                        <TableCell>
                          <IconButton
                            size="small"
                            disabled={rows.length === 1}
                            onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {visibleManualRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleManualColumns.length} align="center">
                        \u0421\u0442\u0440\u043E\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B
                      </TableCell>
                    </TableRow>
                  )}
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
          disabled={create.isPending || !rows.some((row) => row.name.trim())}
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
  onKindChange,
  units,
  departmentId,
  onDepartmentChange,
  dialogOpen,
  onDialogOpenChange,
}: {
  kind: CatalogKind;
  onKindChange: (kind: CatalogKind) => void;
  units: Unit[];
  departmentId: string;
  onDepartmentChange: (departmentId: string) => void;
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

  const departments = useMemo(() => units.filter((unit) => unit.type === 'department' || !unit.parent_id), [units]);
  const sorted = useMemo(() => [...data], [data]);
  const catalogTableColumns = useMemo<TableColumnDefinition<CatalogItem, CatalogTableColumn>[]>(() => [
    { id: 'name', label: 'Название', getValue: (item) => item.name },
    {
      id: 'unit',
      label: 'Объединение',
      getValue: (item) => units.find((unit) => unit.id === item.unit_id)?.name || item.unit_id || '—',
    },
    {
      id: 'active',
      label: 'Активно',
      getValue: (item) => item.is_active ? 'Да' : 'Нет',
      getSortValue: (item) => item.is_active ? 1 : 0,
    },
    { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  ], [units]);
  const {
    clearColumnFilter,
    clearSort,
    filterOptions: catalogFilterOptions,
    filterSearchValues: catalogFilterSearchValues,
    hasActiveFilters: hasActiveCatalogColumnFilters,
    isColumnFiltered: isCatalogColumnFiltered,
    resetFilters: resetCatalogColumnFilters,
    resetVisibility: resetCatalogColumnVisibility,
    rows: visibleCatalogRows,
    selectedFilterValues: selectedCatalogFilterValues,
    setAllFilterOptions: setAllCatalogFilterOptions,
    setFilterSearchValue: setCatalogFilterSearchValue,
    setSortAscending: setCatalogSortAscending,
    setSortDescending: setCatalogSortDescending,
    setVisibleFilterOptions: setCatalogVisibleFilterOptions,
    sort: catalogSort,
    toggleFilterOption: toggleCatalogFilterOption,
    toggleVisibility: toggleCatalogColumnVisibility,
    visibility: catalogColumnVisibility,
    visibleColumns: visibleCatalogColumns,
  } = useTableColumnControls({
    rows: sorted,
    columns: catalogTableColumns,
  });
  const catalogAutoFitValues = useMemo(() => {
    const values = {} as Record<CatalogTableColumn, Array<string | number>>;
    catalogTableColumns.forEach((column) => {
      if (column.id === 'actions') {
        values[column.id] = [column.label, 'Изменить', 'Удалить'];
        return;
      }
      values[column.id] = [
        column.label,
        ...sorted.map((item) => {
          const value = column.getValue(item);
          return value == null || value === '' ? '—' : String(value);
        }),
      ];
    });
    return values;
  }, [catalogTableColumns, sorted]);
  const { columnWidths: catalogColumnWidths, resetColumnWidths: resetCatalogColumnWidths, resizeColumn: resizeCatalogColumn, autoFitColumn: autoFitCatalogColumn } = useTableColumnWidths(
    CATALOG_TABLE_COLUMN_WIDTHS,
    CATALOG_TABLE_COLUMN_MIN_WIDTHS,
    catalogAutoFitValues,
  );
  const catalogTableWidth = visibleCatalogColumns.reduce((sum, column) => sum + catalogColumnWidths[column.id], 0);

  const fitCatalogColumn = (columnId: CatalogTableColumn) => {
    autoFitCatalogColumn(columnId, catalogAutoFitValues[columnId] || [columnId]);
  };

  const renderCatalogHeader = (
    columnId: CatalogTableColumn,
    label: string,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={columnId === 'actions' ? 'Действие' : label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={catalogSort?.column === columnId ? catalogSort.direction : null}
      onSortAscending={() => setCatalogSortAscending(columnId)}
      onSortDescending={() => setCatalogSortDescending(columnId)}
      onClearSort={() => clearSort(columnId)}
      filterOptions={catalogFilterOptions[columnId]}
      selectedFilterValues={selectedCatalogFilterValues[columnId]}
      filterSearchValue={catalogFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setCatalogFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleCatalogFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllCatalogFilterOptions(columnId)}
      onClearColumnFilter={() => clearColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setCatalogVisibleFilterOptions(columnId, false)}
      onResize={(event) => resizeCatalogColumn(columnId, event)}
      onAutoFit={() => fitCatalogColumn(columnId)}
    />
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogDraft>(emptyDraft());
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [meta.path] });

  const startEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setDraft({
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
        parent_id: null,
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
      <Paper className="surface-pad" sx={{ py: { xs: 1, md: 0 }, px: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ minWidth: 0, width: { xs: '100%', md: 'auto' } }}>
            <Tabs value={kind} onChange={(_, value: CatalogKind) => onKindChange(value)} sx={{ minHeight: 56, maxWidth: '100%' }}>
              <Tab value="dds" label="Статьи ДДС" />
              <Tab value="invests" label="Инвест-проекты" />
            </Tabs>
            <TableColumnTools
              columns={catalogTableColumns}
              visibility={catalogColumnVisibility}
              onToggleColumn={toggleCatalogColumnVisibility}
              onResetColumns={resetCatalogColumnVisibility}
              onResetFilters={resetCatalogColumnFilters}
              onResetWidths={resetCatalogColumnWidths}
              hasActiveFilters={hasActiveCatalogColumnFilters}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} className="page-filters" sx={{ width: { xs: '100%', md: 'auto' } }}>
            <TextField select size="small" label="Объединение" value={departmentId} onChange={(event) => onDepartmentChange(event.target.value)} sx={filterFieldSx(280)}>
              {departments.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
            </TextField>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => onDialogOpenChange(true)} disabled={!departmentId}>
              Добавить / импорт
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <TableContainer component={Paper} className="table-surface">
        <Table size="small" sx={{ width: catalogTableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {visibleCatalogColumns.map((column) => <col key={column.id} style={{ width: catalogColumnWidths[column.id] }} />)}
          </colgroup>
          <TableHead>
            <TableRow>
              {catalogColumnVisibility.name && <TableCell>{renderCatalogHeader('name', '\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435')}</TableCell>}
              {catalogColumnVisibility.unit && <TableCell>{renderCatalogHeader('unit', '\u041F\u043E\u0434\u0440\u0430\u0437\u0434\u0435\u043B\u0435\u043D\u0438\u0435')}</TableCell>}
              {catalogColumnVisibility.active && <TableCell>{renderCatalogHeader('active', '\u0410\u043A\u0442\u0438\u0432\u043D\u043E')}</TableCell>}
              {catalogColumnVisibility.actions && <TableCell align="right">{renderCatalogHeader('actions', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', { sortable: false, filterable: false })}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleCatalogRows.map((item) => {
              const editing = editingId === item.id;
              return (
                <TableRow key={item.id} hover>
                  {catalogColumnVisibility.name && (
                    <TableCell sx={{ fontWeight: 500, minWidth: 220 }}>
                      <CatalogCellText
                        editing={editing}
                        value={editing ? draft.name : item.name}
                        onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))}
                      />
                    </TableCell>
                  )}
                  {catalogColumnVisibility.unit && (
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
                  )}
                  {catalogColumnVisibility.active && (
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
                  )}
                  {catalogColumnVisibility.actions && (
                    <TableCell sx={{ minWidth: 140 }}>
                      {editing ? (
                        <Stack direction="row" spacing={0.5} justifyContent="flex-start">
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
                        <Stack direction="row" spacing={0.5} justifyContent="flex-start">
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
                  )}
                </TableRow>
              );
            })}
            {visibleCatalogRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleCatalogColumns.length} align="center">
                  Строки не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <CatalogManageDialog
        open={dialogOpen}
        onClose={() => onDialogOpenChange(false)}
        kind={kind}
        units={units}
        items={data}
        departmentId={departmentId}
        onChanged={refresh}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Удалить ${meta.leafLabel}?`}
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
      {false && (
      <Paper className="surface-pad" sx={{ py: { xs: 1, md: 0 }, px: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" spacing={1.5}>
          <Tabs value={tab} onChange={(_, value: CatalogKind) => setTab(value)} sx={{ minHeight: 56 }}>
            <Tab value="dds" label="Статьи ДДС" />
            <Tab value="invests" label="Инвест-проекты" />
          </Tabs>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField select size="small" label="Объединение" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} sx={{ minWidth: 280 }}>
              {departments.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>)}
            </TextField>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)} disabled={!departmentId}>
              Добавить / импорт
            </Button>
          </Stack>
        </Stack>
      </Paper>
      )}
      <CatalogPanel
        kind={tab}
        onKindChange={setTab}
        units={units}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        dialogOpen={dialogOpen}
        onDialogOpenChange={setDialogOpen}
      />
    </Stack>
  );
}

