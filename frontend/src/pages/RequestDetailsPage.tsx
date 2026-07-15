import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableContainer from '@mui/material/TableContainer';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/Layout';
import { ItemStatusBadge, RequestStatusBadge } from '../components/StatusBadge';
import type { BudgetItem, BudgetRequest, CatalogItem, FileAttachment, ItemStatus, Profile, Unit, User } from '../types';
import { CLOSED_REQUEST_STATUSES } from '../types';
import { downloadAuthorized, downloadBlob } from '../utils/download';
import { itemStatusLabels, money } from '../utils/labels';
import { normalizePositiveAmount } from '../utils/validation';

const UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.xlsx,.docx';
const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const UPLOAD_EXTENSIONS = new Set(UPLOAD_ACCEPT.split(','));

type ItemTableColumn = 'category' | 'article' | 'plan' | 'status' | 'approved' | 'comment' | 'files' | 'actions';

const DEFAULT_ITEM_TABLE_COLUMN_WIDTHS: Record<ItemTableColumn, number> = {
  category: 120,
  article: 260,
  plan: 120,
  status: 150,
  approved: 120,
  comment: 180,
  files: 230,
  actions: 92,
};

const ITEM_TABLE_COLUMN_MIN_WIDTHS: Record<ItemTableColumn, number> = {
  category: 90,
  article: 180,
  plan: 100,
  status: 120,
  approved: 100,
  comment: 130,
  files: 160,
  actions: 72,
};

const ITEM_TABLE_COLUMNS = Object.keys(DEFAULT_ITEM_TABLE_COLUMN_WIDTHS) as ItemTableColumn[];

function uploadValidationError(file: File) {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  if (!UPLOAD_EXTENSIONS.has(extension)) {
    return `Файл «${file.name}» имеет неподдерживаемый формат.`;
  }
  if (file.size === 0) {
    return `Файл «${file.name}» пустой.`;
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `Файл «${file.name}» превышает лимит 25 МБ.`;
  }
  return null;
}

function catalogLabel(item: CatalogItem, catalog: CatalogItem[]) {
  const parent = catalog.find((entry) => entry.id === item.parent_id);
  return parent ? `${parent.name} / ${item.name}` : item.name;
}

function leafItems(catalog: CatalogItem[]) {
  const children = catalog.filter((item) => item.parent_id);
  return [...children].sort((left, right) => {
    const leftParent = catalog.find((item) => item.id === left.parent_id)?.name || '';
    const rightParent = catalog.find((item) => item.id === right.parent_id)?.name || '';
    return leftParent.localeCompare(rightParent, 'ru') || left.name.localeCompare(right.name, 'ru');
  });
}

function selectableItems(catalog: CatalogItem[]) {
  const activeParentIds = new Set(
    catalog
      .filter((item) => item.is_active && item.parent_id)
      .map((item) => item.parent_id),
  );
  return catalog
    .filter((item) => {
      if (!item.is_active) return false;
      if (!item.parent_id) return !activeParentIds.has(item.id);
      return catalog.find((parent) => parent.id === item.parent_id)?.is_active === true;
    })
    .sort((left, right) => {
      const leftParent = catalog.find((item) => item.id === left.parent_id)?.name || '';
      const rightParent = catalog.find((item) => item.id === right.parent_id)?.name || '';
      return leftParent.localeCompare(rightParent, 'ru') || left.name.localeCompare(right.name, 'ru');
    });
}

function isInactiveCatalogSelection(catalog: CatalogItem[], articleId?: string | null) {
  const article = catalog.find((item) => item.id === articleId);
  if (!article) return false;
  const parent = article.parent_id ? catalog.find((item) => item.id === article.parent_id) : undefined;
  return !article.is_active || !!parent && !parent.is_active;
}

function reviewValidationError(item: BudgetItem, draft: Partial<BudgetItem>) {
  const status = draft.status || item.status;
  const sumFact = draft.sum_fact !== undefined ? draft.sum_fact : item.sum_fact;
  if (status === 'approved' && sumFact !== null && Number(sumFact) !== Number(item.sum_plan)) {
    return 'Для статуса «Утверждено» сумма должна совпадать с планом.';
  }
  if (status === 'approved_with_changes' && (sumFact === null || sumFact === undefined || Number(sumFact) === Number(item.sum_plan))) {
    return 'Укажите сумму, отличающуюся от плановой.';
  }
  if (status === 'rejected' && sumFact !== null && Number(sumFact) !== 0) {
    return 'Для отказа сумма должна быть пустой или равна нулю.';
  }
  return '';
}

function categoryName(catalog: CatalogItem[], articleId?: string | null) {
  const item = catalog.find((entry) => entry.id === articleId);
  if (!item?.parent_id) return '—';
  return catalog.find((entry) => entry.id === item.parent_id)?.name || '—';
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || (error instanceof Error ? error.message : fallback);
}

type CounterpartyContact = { user_id: string; login: string; role: 'economist' | 'employee'; profile: Profile | null };
type ItemCreatedWithAttachmentError = Error & { itemCreated: true };

function contactName(contact: CounterpartyContact) {
  const profile = contact.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || contact.login;
}

function ItemFilesCell({
  kind,
  itemId,
  editing,
  stagedFiles,
  pendingDeletedFileIds,
  onRemoveStagedFile,
  onStageDelete,
  onRestoreDelete,
  disabled,
}: {
  kind: 'dds' | 'invest';
  itemId: string;
  editing: boolean;
  stagedFiles: File[];
  pendingDeletedFileIds: number[];
  onRemoveStagedFile: (file: File) => void;
  onStageDelete: (file: FileAttachment) => void;
  onRestoreDelete: (fileId: number) => void;
  disabled: boolean;
}) {
  const { data: files = [] } = useQuery({
    queryKey: ['item-files', kind, itemId],
    queryFn: async () => (await api.get<FileAttachment[]>(`/${kind}-items/${itemId}/files`)).data,
  });
  const visibleFiles = files.filter((file) => !pendingDeletedFileIds.includes(file.id));
  const pendingDeletion = files.filter((file) => pendingDeletedFileIds.includes(file.id));

  return (
    <Stack spacing={0.5} alignItems="stretch" sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      {visibleFiles.map((file) => (
        <Stack key={file.id} direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Tooltip title={file.original_name} disableInteractive>
          <Button
            size="small"
            startIcon={<FileDownloadIcon />}
            onClick={() => downloadAuthorized(`/files/${file.id}/download`, file.original_name)}
            aria-label={`Скачать ${file.original_name}`}
            sx={{
              justifyContent: 'flex-start',
              minWidth: 0,
              maxWidth: '100%',
              flex: 1,
              '& .MuiButton-startIcon': { flexShrink: 0 },
            }}
          >
            <span className="item-file-name">{file.original_name}</span>
          </Button>
          </Tooltip>
          {editing && (
            <Tooltip title="Удалить файл при сохранении">
              <IconButton
                size="small"
                color="default"
                onClick={() => onStageDelete(file)}
                disabled={disabled}
                aria-label="Удалить файл"
                sx={{ color: 'text.secondary', flexShrink: 0 }}
              >
              <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ))}
      {editing && stagedFiles.map((file) => (
        <Chip
          key={`${file.name}-${file.lastModified}`}
          label={`Добавится: ${file.name}`}
          size="small"
          color="primary"
          variant="outlined"
          onDelete={() => onRemoveStagedFile(file)}
          disabled={disabled}
          sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
      ))}
      {editing && pendingDeletion.map((file) => (
        <Chip
          key={file.id}
          label={`Удалится: ${file.original_name}`}
          size="small"
          color="warning"
          variant="outlined"
          onDelete={() => onRestoreDelete(file.id)}
          disabled={disabled}
          sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
      ))}
    </Stack>
  );
}

function FileAttachAction({
  disabled = false,
  onUpload,
}: {
  disabled?: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <Tooltip title="Прикрепить файл">
      <IconButton component="label" size="small" color="primary" disabled={disabled} aria-label="Прикрепить файл">
        <AttachFileIcon fontSize="small" />
        <input
          hidden
          type="file"
          accept={UPLOAD_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </IconButton>
    </Tooltip>
  );
}

function AddItemForm({
  kind,
  requestId,
  catalog,
  disabled,
}: {
  kind: 'dds' | 'invest';
  requestId: string;
  catalog: CatalogItem[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(() => selectableItems(catalog), [catalog]);
  const toast = useAppToast();
  const [article, setArticle] = useState<CatalogItem | null>(null);
  const [sumPlan, setSumPlan] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.post<BudgetItem>(`/requests/${requestId}/${kind}-items`, {
        [kind === 'dds' ? 'dds_id' : 'invest_id']: article?.id,
        sum_plan: Number(sumPlan),
      });
      try {
        for (const file of pendingFiles) {
          const form = new FormData();
          form.append('file', file);
          await api.post(`/${kind}-items/${created.data.id}/files`, form);
        }
      } catch (error) {
        const attachmentError = new Error(
          getErrorMessage(error, 'Строка создана, но не все файлы удалось прикрепить. Добавьте их через кнопку скрепки.'),
        ) as ItemCreatedWithAttachmentError;
        attachmentError.itemCreated = true;
        throw attachmentError;
      }
      return { filesCount: pendingFiles.length };
    },
    onSuccess: ({ filesCount }) => {
      setArticle(null);
      setSumPlan('');
      setPendingFiles([]);
      queryClient.invalidateQueries({ queryKey: ['request-details', requestId] });
      toast(filesCount ? 'Строка и файлы добавлены' : 'Строка добавлена', 'success');
    },
    onError: (error) => {
      if ((error as Partial<ItemCreatedWithAttachmentError>).itemCreated) {
        setArticle(null);
        setSumPlan('');
        setPendingFiles([]);
      }
      queryClient.invalidateQueries({ queryKey: ['request-details', requestId] });
      toast(
        getErrorMessage(error, 'Не удалось добавить строку'),
        'error',
      );
    },
  });

  const addFiles = (files: FileList | null) => {
    const next = Array.from(files || []);
    const invalid = next.map(uploadValidationError).find(Boolean);
    if (invalid) {
      toast(invalid, 'error');
      return;
    }
    setPendingFiles((current) => [
      ...current,
      ...next.filter((file) => !current.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)),
    ]);
  };

  return (
    <Stack spacing={1.25} sx={{ my: 2 }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
      <Autocomplete
        options={options}
        groupBy={(option) => catalog.find((entry) => entry.id === option.parent_id)?.name || 'Без категории'}
        value={article}
        onChange={(_, value) => setArticle(value)}
        getOptionLabel={(item) => catalogLabel(item, catalog)}
        disabled={disabled}
        sx={{ minWidth: 360, flex: 1 }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект'}
            placeholder="Поиск по статьям НСИ"
          />
        )}
      />
      <TextField
        label="Плановая сумма"
        inputProps={{ inputMode: 'decimal' }}
        value={sumPlan}
        onChange={(event) => setSumPlan(normalizePositiveAmount(event.target.value))}
        disabled={disabled}
        sx={{ minWidth: 160 }}
      />
        <Button variant="contained" onClick={() => create.mutate()} disabled={disabled || !article || Number(sumPlan) <= 0 || create.isPending}>
          Добавить строку
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
        <Button component="label" variant="outlined" startIcon={<AttachFileIcon />} disabled={disabled || create.isPending}>
          Выбрать файлы{pendingFiles.length ? ` (${pendingFiles.length})` : ''}
          <input hidden type="file" multiple accept={UPLOAD_ACCEPT} onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }} />
        </Button>
        <Typography variant="body2" color="text.secondary">
          PDF, PNG, JPG, XLSX, DOCX; до 25 МБ каждый.
        </Typography>
      </Stack>
      {pendingFiles.length > 0 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {pendingFiles.map((file) => (
            <Tooltip key={`${file.name}-${file.lastModified}`} title={file.name} disableInteractive>
              <Chip
                label={file.name}
                onDelete={() => setPendingFiles((current) => current.filter((entry) => entry !== file))}
                sx={{ maxWidth: 280, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ItemsTable({
  title,
  kind,
  request,
  user,
  items,
  catalog,
}: {
  title: string;
  kind: 'dds' | 'invest';
  request: BudgetRequest;
  user: User;
  items: BudgetItem[];
  catalog: CatalogItem[];
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const [isEmployeeEditing, setIsEmployeeEditing] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<ItemTableColumn, number>>(DEFAULT_ITEM_TABLE_COLUMN_WIDTHS);
  const [stagedFilesByItem, setStagedFilesByItem] = useState<Record<string, File[]>>({});
  const [pendingDeletedFileIdsByItem, setPendingDeletedFileIdsByItem] = useState<Record<string, number[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);
  const canEmployeeChange = user.role === 'employee' && request.status === 'draft' && !request.budget_frozen;
  const disabledForEmployee = !canEmployeeChange;
  const employeeCanEdit = canEmployeeChange;
  const canEconomist = user.role === 'economist' && request.status === 'on_review' && !request.budget_frozen;
  const canDeleteItem = user.role === 'employee' && request.status === 'draft' && !request.budget_frozen;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request-details', request.id] });
  const tableWidth = ITEM_TABLE_COLUMNS.reduce((sum, column) => sum + columnWidths[column], 0);

  const resizeColumn = (column: ItemTableColumn, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(ITEM_TABLE_COLUMN_MIN_WIDTHS[column], startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [column]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const headerCell = (column: ItemTableColumn) => ({
    width: columnWidths[column],
    minWidth: columnWidths[column],
    maxWidth: columnWidths[column],
    px: 1,
    py: 1,
    position: 'relative' as const,
  });

  const resizeHandle = (column: ItemTableColumn) => (
    <Tooltip title="Перетащите для изменения ширины колонки" placement="top">
      <Box
        component="span"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину колонки"
        onPointerDown={(event) => resizeColumn(column, event)}
        sx={{
          position: 'absolute',
          top: 0,
          right: -4,
          zIndex: 2,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          touchAction: 'none',
          '&:hover::after': {
            content: '""',
            position: 'absolute',
            top: 8,
            bottom: 8,
            left: 3,
            width: 2,
            borderRadius: 1,
            bgcolor: 'primary.main',
          },
        }}
      />
    </Tooltip>
  );

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<BudgetItem> }) => api.patch(`/${kind}-items/${id}`, body),
    onSuccess: (_data, variables) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      refresh();
      toast('Строка сохранена', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить строку'), 'error');
    },
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/${kind}-items/${itemId}`),
    onSuccess: () => {
      refresh();
      toast('Строка удалена', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить строку'), 'error');
    },
  });

  const saveEmployeeChanges = useMutation({
    mutationFn: async () => {
      const changedItemIds = new Set([
        ...Object.keys(drafts),
        ...Object.keys(stagedFilesByItem),
        ...Object.keys(pendingDeletedFileIdsByItem),
      ]);
      for (const itemId of changedItemIds) {
        const body = drafts[itemId] || {};
        if (Object.keys(body).length > 0) {
          await api.patch(`/${kind}-items/${itemId}`, body);
        }
        for (const file of stagedFilesByItem[itemId] || []) {
          const form = new FormData();
          form.append('file', file);
          await api.post(`/${kind}-items/${itemId}/files`, form);
          setStagedFilesByItem((current) => ({
            ...current,
            [itemId]: (current[itemId] || []).filter((entry) => entry !== file),
          }));
        }
        for (const fileId of pendingDeletedFileIdsByItem[itemId] || []) {
          await api.delete(`/${kind}-items/${itemId}/files/${fileId}`);
          setPendingDeletedFileIdsByItem((current) => ({
            ...current,
            [itemId]: (current[itemId] || []).filter((id) => id !== fileId),
          }));
        }
      }
    },
    onSuccess: () => {
      setIsEmployeeEditing(false);
      setDrafts({});
      setStagedFilesByItem({});
      setPendingDeletedFileIdsByItem({});
      refresh();
      queryClient.invalidateQueries({ queryKey: ['item-files', kind] });
      toast('Все изменения сохранены', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить все изменения'), 'error');
    },
  });

  const cancelEmployeeEdit = () => {
    setIsEmployeeEditing(false);
    setDrafts({});
    setStagedFilesByItem({});
    setPendingDeletedFileIdsByItem({});
  };

  const stageFile = (itemId: string, file: File) => {
    const validationError = uploadValidationError(file);
    if (validationError) {
      toast(validationError, 'error');
      return;
    }
    setStagedFilesByItem((current) => {
      const files = current[itemId] || [];
      if (files.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)) {
        return current;
      }
      return { ...current, [itemId]: [...files, file] };
    });
  };

  return (
    <>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Typography variant="h6">{title}</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {employeeCanEdit && (isEmployeeEditing ? (
              <>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SaveOutlinedIcon />}
                  onClick={() => saveEmployeeChanges.mutate()}
                  disabled={saveEmployeeChanges.isPending}
                >
                  Сохранить
                </Button>
                <Tooltip title="Отменить редактирование">
                  <span>
                    <IconButton
                      size="small"
                      onClick={cancelEmployeeEdit}
                      disabled={saveEmployeeChanges.isPending}
                      aria-label="Отменить редактирование"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : (
              <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setIsEmployeeEditing(true)}>
                Изменить
              </Button>
            ))}
            <Tooltip title="Сбросить ширину колонок">
              <IconButton
                size="small"
                onClick={() => setColumnWidths(DEFAULT_ITEM_TABLE_COLUMN_WIDTHS)}
                aria-label="Сбросить ширину колонок"
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        <Typography color="text.secondary">
          {canEconomist
            ? 'Проверьте строки, укажите статус, утверждённую сумму и комментарий.'
            : employeeCanEdit
              ? 'Нажмите «Изменить», чтобы изменить статьи, планы и файлы. Изменения применятся только после общего сохранения.'
              : 'Строки заявки показаны в режиме просмотра. Редактирование и работа с файлами доступны только сотруднику в черновике.'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Перетаскивайте границы заголовков, чтобы настроить ширину колонок.
        </Typography>
      </Stack>
      {employeeCanEdit && <AddItemForm kind={kind} requestId={request.id} catalog={catalog} disabled={disabledForEmployee || isEmployeeEditing} />}
      <TableContainer className="request-items-table">
      <Table size="small" sx={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          {ITEM_TABLE_COLUMNS.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell sx={headerCell('category')}>Категория{resizeHandle('category')}</TableCell>
            <TableCell sx={headerCell('article')}>{kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект'}{resizeHandle('article')}</TableCell>
            <TableCell sx={headerCell('plan')}>План{resizeHandle('plan')}</TableCell>
            <TableCell sx={headerCell('status')}>Статус{resizeHandle('status')}</TableCell>
            <TableCell sx={headerCell('approved')}>Утверждено{resizeHandle('approved')}</TableCell>
            <TableCell sx={headerCell('comment')}>Комментарий{resizeHandle('comment')}</TableCell>
            <TableCell sx={headerCell('files')}>Файл{resizeHandle('files')}</TableCell>
            <TableCell sx={headerCell('actions')} align="center">Действия</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const local = drafts[item.id] || {};
            const hasDraftChanges = Object.keys(local).length > 0;
            const catalogId = kind === 'dds' ? item.dds_id : item.invest_id;
            const inactiveCatalogSelection = isInactiveCatalogSelection(catalog, catalogId);
            const stagedFiles = stagedFilesByItem[item.id] || [];
            const pendingDeletedFileIds = pendingDeletedFileIdsByItem[item.id] || [];
            const validationError = reviewValidationError(item, local);
            return (
              <TableRow
                key={item.id}
                className={inactiveCatalogSelection ? 'inactive-catalog-item' : ''}
                sx={inactiveCatalogSelection ? { '& > .MuiTableCell-root': { bgcolor: 'rgba(237, 108, 2, 0.08)' } } : undefined}
              >
                <TableCell sx={{ px: 1, py: 1 }}>{categoryName(catalog, catalogId)}</TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  {isEmployeeEditing ? (
                    <TextField
                      select
                      size="small"
                      value={(kind === 'dds' ? local.dds_id : local.invest_id) || catalogId || ''}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [item.id]: { ...local, [kind === 'dds' ? 'dds_id' : 'invest_id']: event.target.value },
                        })
                      }
                      sx={{ width: '100%', minWidth: 0 }}
                    >
                      {selectableItems(catalog).map((entry) => <MenuItem key={entry.id} value={entry.id}>{catalogLabel(entry, catalog)}</MenuItem>)}
                      {inactiveCatalogSelection && catalogId && (
                        <MenuItem value={catalogId} disabled>
                          {catalogLabel(catalog.find((entry) => entry.id === catalogId)!, catalog)} (неактивна)
                        </MenuItem>
                      )}
                    </TextField>
                  ) : (
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <span>{catalog.find((entry) => entry.id === catalogId)?.name || catalogId}</span>
                      {inactiveCatalogSelection && <Chip label="НСИ неактивна" size="small" color="warning" variant="outlined" />}
                    </Stack>
                  )}
                </TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  {isEmployeeEditing ? (
                    <TextField
                      size="small"
                      type="number"
                      value={local.sum_plan ?? item.sum_plan}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [item.id]: { ...local, sum_plan: Number(event.target.value) } })
                      }
                      inputProps={{ min: 0 }}
                      sx={{ width: '100%', minWidth: 0 }}
                    />
                  ) : (
                    money(item.sum_plan)
                  )}
                </TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  {canEconomist ? (
                    <TextField
                      select
                      size="small"
                      value={local.status || item.status}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [item.id]: { ...local, status: event.target.value as ItemStatus } })
                      }
                      sx={{ width: '100%', minWidth: 0 }}
                    >
                      {Object.entries(itemStatusLabels).map(([value, label]) => (
                        <MenuItem key={value} value={value}>
                          {label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <ItemStatusBadge status={item.status} />
                  )}
                </TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  {canEconomist ? (
                    <TextField
                      size="small"
                      type="number"
                      value={local.sum_fact ?? item.sum_fact ?? ''}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [item.id]: { ...local, sum_fact: event.target.value === '' ? null : Number(event.target.value) },
                        })
                      }
                      error={!!validationError}
                      helperText={validationError || undefined}
                      sx={{ width: '100%', minWidth: 0 }}
                    />
                  ) : (
                    money(item.sum_fact)
                  )}
                </TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  {canEconomist ? (
                    <TextField
                      size="small"
                      value={local.comment ?? item.comment ?? ''}
                      onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...local, comment: event.target.value } })}
                      sx={{ width: '100%', minWidth: 0 }}
                    />
                  ) : (
                    item.comment || (item.status === 'rejected' ? 'Комментарий рекомендуется' : '—')
                  )}
                </TableCell>
                <TableCell sx={{ px: 1, py: 1 }}>
                  <ItemFilesCell
                    kind={kind}
                    itemId={item.id}
                    editing={isEmployeeEditing}
                    stagedFiles={stagedFiles}
                    pendingDeletedFileIds={pendingDeletedFileIds}
                    onRemoveStagedFile={(file) =>
                      setStagedFilesByItem((current) => ({
                        ...current,
                        [item.id]: (current[item.id] || []).filter((entry) => entry !== file),
                      }))
                    }
                    onStageDelete={(file) =>
                      setPendingDeletedFileIdsByItem((current) => ({
                        ...current,
                        [item.id]: [...new Set([...(current[item.id] || []), file.id])],
                      }))
                    }
                    onRestoreDelete={(fileId) =>
                      setPendingDeletedFileIdsByItem((current) => ({
                        ...current,
                        [item.id]: (current[item.id] || []).filter((id) => id !== fileId),
                      }))
                    }
                    disabled={saveEmployeeChanges.isPending}
                  />
                </TableCell>
                <TableCell align="center" sx={{ px: 1, py: 1 }}>
                  <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
                    {isEmployeeEditing && (
                      <FileAttachAction
                        disabled={saveEmployeeChanges.isPending}
                        onUpload={(file) => stageFile(item.id, file)}
                      />
                    )}
                    {canEconomist ? (
                      <Tooltip title={validationError || 'Сохранить изменения строки'}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => patch.mutate({ id: item.id, body: drafts[item.id] || {} })}
                          disabled={!hasDraftChanges || !!validationError || patch.isPending}
                          aria-label="Сохранить"
                        >
                          <SaveOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : employeeCanEdit && !isEmployeeEditing ? (
                      <>
                        <Tooltip title="Удалить строку">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteTarget(item)}
                            aria-label="Удалить строку"
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : canDeleteItem && !isEmployeeEditing ? (
                      <Tooltip title="Удалить строку">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteTarget(item)}
                          aria-label="Удалить строку"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </TableContainer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить строку?"
        description={`Строка «${deleteTarget ? catalog.find((entry) => entry.id === (kind === 'dds' ? deleteTarget.dds_id : deleteTarget.invest_id))?.name || '' : ''}» будет удалена вместе со связями файлов.`}
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteItem.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteItem.mutate(deleteTarget.id)}
      />
    </>
  );
}

export default function RequestDetailsPage({ user }: { user: User }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const detailsKey = ['request-details', id];
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'withdraw' | 'approve-all-items' | null>(null);

  const { data: request } = useQuery({
    queryKey: detailsKey,
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${id}`)).data,
  });
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get<Unit[]>('/units')).data,
  });
  const { data: counterparty } = useQuery({
    queryKey: [...detailsKey, 'counterparty-contact'],
    queryFn: async () => (await api.get<CounterpartyContact | null>(`/requests/${id}/counterparty-contact`)).data,
    enabled: !!request && (user.role === 'economist' || user.role === 'employee'),
  });
  const { data: dds = [] } = useQuery({
    queryKey: [...detailsKey, 'dds'],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/dds-items`)).data,
    enabled: !!request,
  });
  const { data: invest = [] } = useQuery({
    queryKey: [...detailsKey, 'invest'],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/invest-items`)).data,
    enabled: !!request,
  });

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const requestDepartmentId = useMemo(() => {
    let currentId = request?.unit_id || '';
    while (currentId) {
      const unit = unitById.get(currentId);
      if (!unit?.parent_id) return currentId;
      currentId = unit.parent_id;
    }
    return request?.unit_id || '';
  }, [request?.unit_id, unitById]);
  const formatUnitName = (unitId: string | null | undefined) => unitById.get(unitId || '')?.name || unitId || '—';
  const requestUnitName = formatUnitName(request?.unit_id);
  const employeeUnitNames = useMemo(
    () => (user.unit_ids || []).map((unitId) => formatUnitName(unitId)).filter(Boolean),
    [unitById, user.unit_ids],
  );
  const catalogUnitId = requestDepartmentId;
  // Keep inactive records in the response so already saved request lines can be identified.
  // selectableItems still exposes only active records in create/edit controls.
  const catalogParams = { unit_id: catalogUnitId || undefined };
  const { data: ddsCatalog = [] } = useQuery({
    queryKey: ['dds-catalog', catalogUnitId],
    queryFn: async () => (await api.get<CatalogItem[]>('/catalog/dds', { params: catalogParams })).data,
    enabled: !!catalogUnitId,
  });
  const { data: investCatalog = [] } = useQuery({
    queryKey: ['invest-catalog', catalogUnitId],
    queryFn: async () => (await api.get<CatalogItem[]>('/catalog/invests', { params: catalogParams })).data,
    enabled: !!catalogUnitId,
  });

  const lifecycle = useMutation({
    mutationFn: (action: string) => api.post(`/requests/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: detailsKey }),
  });

  const deleteRequest = useMutation({
    mutationFn: () => api.delete(`/requests/${id}`),
    onSuccess: () => {
      toast('Заявка удалена', 'success');
      setDeleteOpen(false);
      navigate('/requests');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить заявку'), 'error');
    },
  });

  const allItems = useMemo(() => [...dds, ...invest], [dds, invest]);
  const deletePreviewRows = useMemo(() => {
    const rows = [
      ...dds.map((item) => ({
        kind: 'ДДС',
        name: ddsCatalog.find((entry) => entry.id === item.dds_id)?.name || item.dds_id,
        sum: item.sum_plan,
      })),
      ...invest.map((item) => ({
        kind: 'Инвест',
        name: investCatalog.find((entry) => entry.id === item.invest_id)?.name || item.invest_id,
        sum: item.sum_plan,
      })),
    ];
    return rows.slice(0, 5);
  }, [dds, ddsCatalog, invest, investCatalog]);
  const canSubmit = user.role === 'employee' && request && request.status === 'draft' && !request.budget_frozen && allItems.length > 0;
  const canWithdraw = user.role === 'employee' && request && request.status === 'on_review' && !request.budget_frozen;
  const canCancel = user.role === 'employee' && request && request.status === 'on_review' && !request.budget_frozen;
  const canFinalize = user.role === 'economist' && request && request.status === 'on_review' && !request.budget_frozen && allItems.length > 0 && allItems.every((item) => item.status !== 'on_review');
  const canApproveAllItems = user.role === 'economist' && request && request.status === 'on_review' && !request.budget_frozen && allItems.some((item) => item.status === 'on_review');
  const canFreezeBudget = user.role === 'economist' && request && !request.budget_frozen && ['approved', 'approved_with_changes'].includes(request.status);
  const canUnfreezeBudget = user.role === 'economist' && request && request.budget_frozen;
  const isClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status);
  const isHighlightedClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status) && request.status !== 'cancelled';
  const canDelete = !!request && request.status === 'draft' && user.role === 'employee' && !request.budget_frozen;
  const canReopen =
    user.role === 'economist' &&
    !!request &&
    !request.budget_frozen &&
    ['approved', 'approved_with_changes', 'partially_approved', 'rejected'].includes(request.status);

  const exportRequest = async () => {
    const response = await api.get(`/requests/${id}/export`, { responseType: 'blob' });
    downloadBlob(response.data, `request_${id.slice(0, 8)}.xlsx`);
  };

  if (!request) return <Typography>Загрузка заявки...</Typography>;

  return (
    <Stack spacing={3}>
      <Stack spacing={3}>
        <Card className={`metric-card request-summary-card ${isHighlightedClosed ? 'fixed-request' : ''} ${request.budget_frozen ? 'budget-frozen-card' : ''}`} elevation={0}>
          <CardContent className="request-summary-content">
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} justifyContent="space-between">
                <Stack spacing={1.25}>
                  <Typography variant="h6">Сводка заявки</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <RequestStatusBadge status={request.status} />
                    {request.budget_frozen && <Chip label="Бюджет зафиксирован" size="small" color="warning" variant="outlined" />}
                  </Stack>
                </Stack>
                <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                  <Stack className="request-summary-actions" direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                    {canFreezeBudget && (
                      <Button startIcon={<LockOutlinedIcon />} variant="outlined" onClick={() => lifecycle.mutate('freeze-budget')}>
                        Зафиксировать бюджет
                      </Button>
                    )}
                    {canUnfreezeBudget && (
                      <Button startIcon={<LockOpenOutlinedIcon />} variant="outlined" onClick={() => lifecycle.mutate('unfreeze-budget')}>
                        Разморозить бюджет
                      </Button>
                    )}
                    {canApproveAllItems && (
                      <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => setConfirmAction('approve-all-items')}>
                        Зафиксировать все строки
                      </Button>
                    )}
                    {canWithdraw && (
                      <Button startIcon={<UndoIcon />} variant="outlined" onClick={() => setConfirmAction('withdraw')}>
                        Отозвать в черновик
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        startIcon={<DeleteOutlineIcon />}
                        variant="outlined"
                        color="error"
                        onClick={() => lifecycle.mutate('cancel')}
                      >
                        Отменить заявку
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        startIcon={<DeleteOutlineIcon />}
                        variant="outlined"
                        onClick={() => setDeleteOpen(true)}
                        sx={{
                          color: 'text.secondary',
                          borderColor: 'divider',
                          '&:hover': {
                            borderColor: 'text.secondary',
                            bgcolor: 'action.hover',
                          },
                        }}
                      >
                        Удалить заявку
                      </Button>
                    )}
                    {canSubmit && (
                      <Button startIcon={<SendIcon />} variant="contained" onClick={() => lifecycle.mutate('submit')}>
                        Отправить заявку
                      </Button>
                    )}
                    {canFinalize && (
                      <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => lifecycle.mutate('finalize')}>
                        Завершить проверку
                      </Button>
                    )}
                    {isClosed && (
                      <Button startIcon={<FileDownloadIcon />} variant="outlined" onClick={exportRequest}>
                        Экспорт Excel
                      </Button>
                    )}
                    {canReopen && (
                      <Button startIcon={<UndoIcon />} variant="outlined" onClick={() => lifecycle.mutate('reopen')}>
                        Вернуть на рассмотрение
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Stack>
              {request.budget_frozen && (
                <Alert severity="warning" variant="outlined">
                  Бюджет зафиксирован. Пока он не разморожен, редактирование заявки, строк и файлов недоступно.
                </Alert>
              )}
              <Box className="request-summary-context">
                <Typography variant="caption" color="text.secondary">Объединение заявки</Typography>
                <Typography fontWeight={700}>{requestUnitName}</Typography>
                {user.role === 'employee' ? (
                  <>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25 }}>Объединение сотрудника</Typography>
                    <Typography fontWeight={700}>{employeeUnitNames.length ? employeeUnitNames.join(', ') : 'не назначено'}</Typography>
                  </>
                ) : null}
              </Box>
              <Box className="request-summary-metrics">
                <Box className="request-summary-metric request-summary-metric-primary">
                  <Typography variant="caption" color="text.secondary">План</Typography>
                  <Typography variant="h6">{money(request.summary?.planned_sum)}</Typography>
                </Box>
                <Box className="request-summary-metric request-summary-metric-approved">
                  <Typography variant="caption" color="text.secondary">Утверждено</Typography>
                  <Typography variant="h6">{money(request.summary?.approved_sum)}</Typography>
                </Box>
                <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">Строк</Typography>
                  <Typography variant="h6">{request.summary?.items_count || 0}</Typography>
                </Box>
                <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">Принято</Typography>
                  <Typography variant="h6" color="success.main">{request.summary?.accepted_count || 0}</Typography>
                </Box>
                <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">Отказано</Typography>
                  <Typography variant="h6" color="error.main">{request.summary?.rejected_count || 0}</Typography>
                </Box>
                <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">На рассмотрении</Typography>
                  <Typography variant="h6" color="warning.main">{request.summary?.in_review_count || 0}</Typography>
                </Box>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {counterparty ? (
          <Paper className="surface-pad" elevation={0}>
            <Stack spacing={0.75}>
              <Typography variant="h6">{user.role === 'economist' ? 'Контакты сотрудника модуля' : 'Контакты экономиста'}</Typography>
              <Typography fontWeight={700}>{contactName(counterparty)}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} flexWrap="wrap" useFlexGap>
                <Typography color="text.secondary">Телефон: {counterparty.profile?.phone || 'не указан'}</Typography>
                <Typography color="text.secondary">Email: {counterparty.profile?.email || 'не указан'}</Typography>
                {counterparty.profile?.max_link ? <Typography color="text.secondary">Max: {counterparty.profile.max_link}</Typography> : null}
              </Stack>
            </Stack>
          </Paper>
        ) : null}

        <Paper className={`surface-pad ${request.budget_frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          <ItemsTable title="Строки ДДС" kind="dds" request={request} user={user} items={dds} catalog={ddsCatalog} />
        </Paper>

        <Paper className={`surface-pad ${request.budget_frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          <ItemsTable title="Строки инвест-проектов" kind="invest" request={request} user={user} items={invest} catalog={investCatalog} />
        </Paper>
      </Stack>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction === 'withdraw' ? 'Отозвать заявку в черновик?' : 'Зафиксировать все строки?'}
        description={
          confirmAction === 'withdraw'
            ? 'Заявка вернётся в черновик, и сотрудник снова сможет изменять строки и файлы.'
            : 'Все ещё не рассмотренные строки будут утверждены. Фактическая сумма для них будет принята равной плановой, после чего проверка завершится.'
        }
        confirmLabel={confirmAction === 'withdraw' ? 'Отозвать' : 'Зафиксировать все'}
        pending={lifecycle.isPending}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (!confirmAction) return;
          lifecycle.mutate(confirmAction, { onSuccess: () => setConfirmAction(null) });
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить заявку?"
        maxWidth="md"
        description={
          <Stack spacing={1.5}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 0.75 }}>Тип</TableCell>
                  <TableCell sx={{ py: 0.75 }}>Статья / проект</TableCell>
                  <TableCell sx={{ py: 0.75 }} align="right">План</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {deletePreviewRows.map((row, index) => (
                  <TableRow key={`${row.kind}-${row.name}-${index}`}>
                    <TableCell sx={{ py: 0.75 }}>{row.kind}</TableCell>
                    <TableCell sx={{ py: 0.75 }}>{row.name}</TableCell>
                    <TableCell sx={{ py: 0.75 }} align="right">
                      {money(row.sum)}
                    </TableCell>
                  </TableRow>
                ))}
                {allItems.length > deletePreviewRows.length && (
                  <TableRow>
                    <TableCell sx={{ py: 0.75 }} colSpan={3}>
                      Ещё строк: {allItems.length - deletePreviewRows.length}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Stack>
        }
        confirmLabel="Удалить"
        confirmColor="error"
        pending={deleteRequest.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteRequest.mutate()}
      />
    </Stack>
  );
}
