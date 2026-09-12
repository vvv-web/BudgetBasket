import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { InlineEditTextCell } from '../components/inlineEdit';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
import { PageSkeleton } from '../components/PageSkeleton';
import type { CatalogItem, Unit, User } from '../types';
import { filterFieldSx } from '../utils/responsive';
import { downloadBlob } from '../utils/download';
import { getApiErrorMessage } from '../utils/apiErrors';

type CatalogKind = 'dds' | 'invests';
type CategoryRow = CatalogItem & { article: CatalogItem };
type CatalogActionTarget = { item: CatalogItem; action: 'delete' | 'deactivate' };
type ImportPreview = {
  created: number;
  updated: number;
  errors: string[];
  rows: Array<{ row: number; name: string; category: string | null; unit_name: string; action?: 'create' | 'update' | 'skip' }>;
};
type ManualNsiRow = { id: string; article: string; category: string; unit_id: string; is_active: boolean };

const emptyManualRow = (unitId: string): ManualNsiRow => ({
  id: crypto.randomUUID(), article: '', category: '', unit_id: unitId, is_active: true,
});

const META: Record<CatalogKind, { title: string; path: string; article: string }> = {
  dds: { title: 'Статьи ДДС', path: '/catalog/dds', article: 'Статья ДДС' },
  invests: { title: 'Инвест-проекты', path: '/catalog/invests', article: 'Инвест-проект' },
};

function ImportDialog({ open, kind, departmentId, departments, catalog, onClose, onDownloadTemplate, onImported }: {
  open: boolean; kind: CatalogKind; departmentId: string; departments: Unit[]; catalog: CatalogItem[]; onClose: () => void; onDownloadTemplate: () => void;
  onImported: (result: ImportPreview) => void;
}) {
  const toast = useAppToast();
  const meta = META[kind];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ManualNsiRow[]>([emptyManualRow(departmentId)]);
  useEffect(() => {
    if (open) setRows([emptyManualRow(departmentId)]);
    else { setFile(null); setPreview(null); }
  }, [open, departmentId]);
  const upload = (selected: File, previewOnly: boolean) => {
    const body = new FormData();
    body.append('file', selected);
    return api.post<ImportPreview>(`/catalog/${kind}/import`, body, { params: { preview: previewOnly } }).then((response) => response.data);
  };
  const previewImport = useMutation({
    mutationFn: (selected: File) => upload(selected, true),
    onSuccess: (result) => setPreview(result),
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось прочитать файл'), 'error'),
  });
  const commitImport = useMutation({
    mutationFn: () => file ? upload(file, false) : Promise.reject(new Error('Выберите файл')),
    onSuccess: (result) => { onImported(result); onClose(); },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось импортировать НСИ'), 'error'),
  });
  const saveManualRows = useMutation({
    mutationFn: async () => {
      const prepared = rows.filter((row) => row.article.trim());
      if (!prepared.length) throw new Error('Заполните хотя бы одну строку');
      const currentCatalog = [...catalog];
      let created = 0;
      let updated = 0;
      for (const row of prepared) {
        const articleName = row.article.trim();
        const categoryName = row.category.trim();
        let article = currentCatalog.find((item) => !item.parent_id && item.unit_id === row.unit_id && item.name.trim().toLocaleLowerCase() === articleName.toLocaleLowerCase());
        const articleCreated = !article;
        if (!article) {
          article = (await api.post<CatalogItem>(meta.path, {
            name: articleName,
            unit_id: row.unit_id,
            is_active: row.is_active,
            // The fallback is intentional only for a blank Category cell.
            create_default_category: !categoryName,
          })).data;
          currentCatalog.push(article);
          created += 1;
        }
        if (!categoryName) {
          const result = (await api.post<{ created: boolean }>(`${meta.path}/${article.id}/default-category`)).data;
          created += Number(result.created && !articleCreated);
          continue;
        }
        let category = currentCatalog.find((item) => item.parent_id === article!.id && item.name.trim().toLocaleLowerCase() === categoryName.toLocaleLowerCase());
        if (!category) {
          category = (await api.post<CatalogItem>(meta.path, { parent_id: article.id, name: categoryName, unit_id: row.unit_id, is_active: row.is_active })).data;
          currentCatalog.push(category);
          created += 1;
        } else if (category && category.is_active !== row.is_active) {
          await api.patch(`${meta.path}/${category.id}`, { is_active: row.is_active });
          updated += 1;
        }
      }
      return { created, updated, errors: [], rows: [] } as ImportPreview;
    },
    onSuccess: (result) => { toast(`Сохранено: создано ${result.created}, обновлено ${result.updated}`, 'success'); onImported(result); setRows([emptyManualRow(departmentId)]); },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось сохранить строки'), 'error'),
  });
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Typography component="span" variant="h6" sx={{ flex: 1, minWidth: 0 }}>Управление НСИ · {meta.title}</Typography>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<DownloadIcon />} variant="outlined" onClick={onDownloadTemplate}>Скачать шаблон</Button>
        <Button component="label" startIcon={<UploadFileIcon />} variant="contained" disabled={previewImport.isPending}>
          Импорт<input hidden type="file" accept=".xlsx" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) { setFile(selected); setPreview(null); previewImport.mutate(selected); } event.target.value = ''; }} />
        </Button>
      </Stack>
    </DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      <Box><Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Статьи и категории</Typography><Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>{meta.article}</TableCell><TableCell>Категория</TableCell><TableCell>Объединение</TableCell><TableCell>Активна</TableCell><TableCell width={56} /></TableRow></TableHead><TableBody>
        {rows.map((row) => <TableRow key={row.id}><TableCell><TextField size="small" fullWidth value={row.article} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, article: event.target.value } : item))} /></TableCell><TableCell><TextField size="small" fullWidth placeholder="Пусто — одноимённая, если нет других" value={row.category} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, category: event.target.value } : item))} /></TableCell><TableCell><TextField select size="small" fullWidth value={row.unit_id} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, unit_id: event.target.value } : item))}>{departments.map((department) => <MenuItem key={department.id} value={department.id}>{department.name}</MenuItem>)}</TextField></TableCell><TableCell><TextField select size="small" fullWidth value={row.is_active ? 'yes' : 'no'} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, is_active: event.target.value === 'yes' } : item))}><MenuItem value="yes">Да</MenuItem><MenuItem value="no">Нет</MenuItem></TextField></TableCell><TableCell><IconButton size="small" disabled={rows.length === 1} onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell></TableRow>)}
      </TableBody></Table></Box><Button sx={{ mt: 1 }} startIcon={<AddIcon />} variant="outlined" onClick={() => setRows((items) => [...items, emptyManualRow(departmentId)])}>Добавить строку</Button></Box>
      {file && <Typography variant="body2" color="text.secondary">Файл: {file.name}</Typography>}
      {previewImport.isPending && <Typography color="text.secondary">Подготовка предварительного просмотра…</Typography>}
      {preview && <><Alert severity={preview.errors.length ? 'warning' : 'info'}>
        <Typography component="div">Импорт завершён: в таблицу ниже подставлено {preview.rows.length} строк. Будет создано: {preview.created}; обновлено: {preview.updated}.</Typography>
        {preview.errors.length > 0 && <Box sx={{ mt: 1 }}>
          <Typography component="div" variant="body2" fontWeight={600}>Ошибки импорта:</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {preview.errors.map((error, index) => <Box component="li" key={`${index}-${error}`} sx={{ mb: 0.25 }}>{error}</Box>)}
          </Box>
        </Box>}
      </Alert>
        <Box><Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Предпросмотр импорта</Typography><Box sx={{ maxHeight: 320, overflow: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Статья / проект</TableCell><TableCell>Категория</TableCell><TableCell>Объединение</TableCell><TableCell>Действие</TableCell></TableRow></TableHead><TableBody>
          {preview.rows.map((row) => <TableRow key={row.row}><TableCell>{row.name}</TableCell><TableCell>{row.category || row.name}</TableCell><TableCell>{row.unit_name || 'По умолчанию'}</TableCell><TableCell>{row.action === 'update' ? 'Обновить' : row.action === 'skip' ? 'Без изменений' : 'Создать'}</TableCell></TableRow>)}
        </TableBody></Table></Box></Box>
      </>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Отмена</Button><Button variant="outlined" disabled={saveManualRows.isPending || !rows.some((row) => row.article.trim())} onClick={() => saveManualRows.mutate()}>Сохранить строки</Button><Button variant="outlined" disabled={!file || !preview || preview.errors.length > 0 || commitImport.isPending} onClick={() => commitImport.mutate()}>Импортировать файл</Button></DialogActions>
  </Dialog>;
}

function CategoryDialog({ open, kind, departmentId, articles, onClose }: {
  open: boolean; kind: CatalogKind; departmentId: string; articles: CatalogItem[]; onClose: () => void;
}) {
  const meta = META[kind];
  const toast = useAppToast();
  const queryClient = useQueryClient();
  const [articleId, setArticleId] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) { setArticleId(articles[0]?.id || ''); setName(articles[0]?.name || ''); }
  }, [open, articles]);
  const create = useMutation({
    mutationFn: () => api.post(meta.path, { parent_id: articleId, name: name.trim(), unit_id: departmentId, is_active: true }),
    onSuccess: () => { toast('Категория создана', 'success'); queryClient.invalidateQueries({ queryKey: [meta.path] }); onClose(); },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось создать категорию'), 'error'),
  });
  const changeArticle = (id: string) => { setArticleId(id); setName(articles.find((article) => article.id === id)?.name || ''); };
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>Добавить категорию</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
      <TextField select fullWidth label={meta.article} value={articleId} onChange={(event) => changeArticle(event.target.value)}>
        {articles.map((article) => <MenuItem key={article.id} value={article.id}>{article.name}</MenuItem>)}
      </TextField>
      <TextField fullWidth label="Категория" value={name} onChange={(event) => setName(event.target.value)} />
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Отмена</Button><Button variant="contained" disabled={!articleId || !name.trim() || create.isPending} onClick={() => create.mutate()}>Создать</Button></DialogActions>
  </Dialog>;
}

export default function CatalogsPage({ user }: { user: User }) {
  const toast = useAppToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CatalogKind>('dds');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<CatalogActionTarget | null>(null);
  const meta = META[kind];
  const { data: units = [], isLoading: unitsLoading } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const departments = useMemo(() => units.filter((unit) => unit.type === 'department' || !unit.parent_id), [units]);
  useEffect(() => { if (!departmentId && departments.length) setDepartmentId(departments[0].id); }, [departmentId, departments]);
  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: [meta.path, departmentId],
    queryFn: async () => (await api.get<CatalogItem[]>(meta.path, { params: { unit_id: departmentId || undefined } })).data,
    enabled: Boolean(departmentId),
  });
  const articles = useMemo(() => catalog.filter((item) => !item.parent_id).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [catalog]);
  const rows = useMemo<CategoryRow[]>(() => catalog
    .filter((category) => category.parent_id)
    .map((category) => ({ ...category, article: catalog.find((item) => item.id === category.parent_id)! }))
    .filter((row) => !!row.article)
    .sort((a, b) => a.article.name.localeCompare(b.article.name, 'ru') || a.name.localeCompare(b.name, 'ru')),
  [catalog]);
  const { visibleArticles, visibleRows } = useMemo(() => {
    const searchTerms = search.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
    if (!searchTerms.length) return { visibleArticles: articles, visibleRows: rows };

    const matches = (values: string[]) => {
      const searchableText = values.join(' ').toLocaleLowerCase('ru-RU');
      return searchTerms.every((term) => searchableText.includes(term));
    };
    const matchingArticleIds = new Set(
      articles.filter((article) => matches([article.name])).map((article) => article.id),
    );
    const nextRows = rows.filter((row) => matchingArticleIds.has(row.article.id) || matches([row.name, row.article.name]));
    const visibleArticleIds = new Set([
      ...matchingArticleIds,
      ...nextRows.map((row) => row.article.id),
    ]);

    return {
      visibleArticles: articles.filter((article) => visibleArticleIds.has(article.id)),
      visibleRows: nextRows,
    };
  }, [articles, rows, search]);
  const canManageCategories = user.role === 'admin' || (
    user.role === 'economist'
    && units.some((unit) => unit.parent_id === departmentId && user.unit_ids?.includes(unit.id))
  );
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string; is_active: boolean } }) => api.patch(`${meta.path}/${id}`, { name: body.name.trim(), is_active: body.is_active }),
    onSuccess: (_response, variables) => {
      toast(variables.body.is_active ? 'Запись обновлена' : 'Запись деактивирована', 'success');
      setActionTarget(null);
      queryClient.invalidateQueries({ queryKey: [meta.path] });
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось обновить запись'), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${meta.path}/${id}`),
    onSuccess: () => {
      toast('Запись удалена', 'success');
      setActionTarget(null);
      queryClient.invalidateQueries({ queryKey: [meta.path] });
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось удалить запись'), 'error'),
  });
  const downloadTemplate = async () => {
    try {
      const response = await api.get(`/catalog/${kind}/import-template`, { responseType: 'blob' });
      downloadBlob(response.data, `nsi_${kind}_template.xlsx`);
    } catch (error) {
      toast(getApiErrorMessage(error, 'Не удалось скачать шаблон'), 'error');
    }
  };

  if (unitsLoading || (departments.length > 0 && (!departmentId || catalogLoading))) {
    return <PageSkeleton variant="table" label="Загрузка справочников" />;
  }

  return <Stack spacing={2.5}>
    <Paper className="surface-pad"><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
      <Tabs value={kind} onChange={(_, value: CatalogKind) => setKind(value)}><Tab value="dds" label="Статьи ДДС" /><Tab value="invests" label="Инвест-проекты" /></Tabs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField select size="small" label="Объединение" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} sx={filterFieldSx(280)}>
          {departments.map((department) => <MenuItem key={department.id} value={department.id}>{department.name}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          label="Поиск"
          placeholder={`${meta.article}, категория`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          inputProps={{ 'aria-label': `Поиск по ${meta.title.toLocaleLowerCase()}` }}
          sx={filterFieldSx(260)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} color="action" /></InputAdornment> }}
        />
        {user.role === 'admin' && <Button startIcon={<AddIcon />} variant="contained" onClick={() => setImportDialogOpen(true)} disabled={!departmentId}>Добавить / импорт</Button>}
        {canManageCategories && <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setCategoryDialogOpen(true)} disabled={!articles.length}>Добавить категорию</Button>}
      </Stack>
    </Stack></Paper>
    <Paper className="surface-pad"><Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      Статья или инвест-проект находится на верхнем уровне. При пустой категории создаётся одноимённая категория, только если у статьи ещё нет категорий.
    </Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
      Изменения в строках сохраняются сразу; во время редактирования нажмите Esc, чтобы отменить несохранённое изменение.
    </Typography>
    <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>{meta.article} / категория</TableCell><TableCell>Уровень</TableCell><TableCell>Активна</TableCell>{(user.role === 'admin' || canManageCategories) && <TableCell>Действия</TableCell>}</TableRow></TableHead>
      <TableBody>{visibleArticles.map((article) => {
        const categories = visibleRows.filter((row) => row.article.id === article.id);
        return <Fragment key={article.id}>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell>
              <InlineEditTextCell
                value={article.name}
                editable={user.role === 'admin'}
                ariaLabel={meta.article}
                tooltip={`Нажмите, чтобы изменить: ${meta.article.toLocaleLowerCase()}`}
                onCommit={(name) => update.mutate({ id: article.id, body: { name, is_active: article.is_active } })}
              />
            </TableCell>
            <TableCell><Typography fontWeight={700}>{meta.article}</Typography></TableCell>
            <TableCell>{article.is_active ? 'Да' : 'Нет'}</TableCell>
            {(user.role === 'admin' || canManageCategories) && <TableCell>
              {user.role === 'admin' && <Stack direction="row" spacing={0.5}>
                {article.is_active ? (
                  <Button size="small" color="warning" onClick={() => setActionTarget({ item: article, action: 'deactivate' })}>Деактивировать</Button>
                ) : (
                  <Button size="small" onClick={() => update.mutate({ id: article.id, body: { name: article.name, is_active: true } })}>Активировать</Button>
                )}
                <Tooltip title={article.delete_block_reason || `Удалить: ${meta.article.toLocaleLowerCase()}`}>
                  <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setActionTarget({ item: article, action: 'delete' })}>Удалить</Button>
                </Tooltip>
              </Stack>}
            </TableCell>}
          </TableRow>
          {categories.map((row) => <TableRow key={row.id}>
            <TableCell sx={{ pl: 4 }}>
              <InlineEditTextCell
                value={row.name}
                editable={canManageCategories}
                ariaLabel="Категория"
                tooltip="Нажмите, чтобы изменить категорию"
                onCommit={(name) => update.mutate({ id: row.id, body: { name, is_active: row.is_active } })}
              />
            </TableCell>
            <TableCell>Категория</TableCell>
            <TableCell>{row.is_active ? 'Да' : 'Нет'}</TableCell>
            {(user.role === 'admin' || canManageCategories) && <TableCell><Stack direction="row" spacing={0.5}>
              {row.is_active ? (
                <Button size="small" color="warning" onClick={() => setActionTarget({ item: row, action: 'deactivate' })}>Деактивировать</Button>
              ) : (
                <Button size="small" onClick={() => update.mutate({ id: row.id, body: { name: row.name, is_active: true } })}>Активировать</Button>
              )}
              <Tooltip title={row.delete_block_reason || 'Удалить категорию'}>
                <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setActionTarget({ item: row, action: 'delete' })}>Удалить</Button>
              </Tooltip>
            </Stack></TableCell>}
          </TableRow>)}
        </Fragment>;
      })}{visibleArticles.length === 0 && <TableRow><TableCell colSpan={(user.role === 'admin' || canManageCategories) ? 4 : 3} align="center">Записи НСИ не найдены</TableCell></TableRow>}</TableBody>
    </Table></Box></Paper>
    <ImportDialog open={importDialogOpen} kind={kind} departmentId={departmentId} departments={departments} catalog={catalog} onClose={() => setImportDialogOpen(false)} onDownloadTemplate={downloadTemplate} onImported={(result) => { if (result.rows.length) toast(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}`, 'success'); queryClient.invalidateQueries({ queryKey: [meta.path] }); }} />
    <CategoryDialog open={categoryDialogOpen} kind={kind} departmentId={departmentId} articles={articles} onClose={() => setCategoryDialogOpen(false)} />
    <ConfirmDialog
      open={!!actionTarget}
      title={actionTarget?.action === 'delete' ? 'Удалить запись НСИ?' : 'Деактивировать запись НСИ?'}
      description={actionTarget?.action === 'delete'
        ? `Запись «${actionTarget.item.name}» будет физически удалена. Это действие нельзя отменить.`
        : `Запись «${actionTarget?.item.name || ''}» перестанет быть доступна для нового выбора, но сохранится в существующих заявках.`}
      confirmLabel={actionTarget?.action === 'delete' ? 'Удалить' : 'Деактивировать'}
      confirmColor={actionTarget?.action === 'delete' ? 'error' : 'warning'}
      pending={remove.isPending || update.isPending}
      onClose={() => setActionTarget(null)}
      onConfirm={() => {
        if (!actionTarget) return;
        if (actionTarget.action === 'delete') remove.mutate(actionTarget.item.id);
        else update.mutate({ id: actionTarget.item.id, body: { name: actionTarget.item.name, is_active: false } });
      }}
    />
  </Stack>;
}
