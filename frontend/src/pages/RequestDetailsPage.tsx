import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Drawer from '@mui/material/Drawer';
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
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { chatDayKey, chatDayLabel } from '../utils/chat';
import { requestChatWebSocketUrl } from '../api/websocket';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FilePreviewDialog } from '../components/FilePreviewDialog';
import { useAppToast } from '../components/Layout';
import { TableColumnHeader, TableColumnTools } from '../components/TableColumnControls';
import { ItemStatusBadge, RequestStatusBadge } from '../components/StatusBadge';
import type { ApprovalStep, BudgetItem, BudgetRequest, CatalogItem, FileAttachment, ItemStatus, Profile, StepLog, StepStatus, Unit, User } from '../types';
import { CLOSED_REQUEST_STATUSES } from '../types';
import { downloadBlob } from '../utils/download';
import { itemStatusLabels, money, requestStatusLabels, stepStatusLabels } from '../utils/labels';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';
import { normalizePositiveAmount } from '../utils/validation';
import { AUTH_TOKEN_KEY } from '../utils/session';

const UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.xlsx,.docx';
const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const UPLOAD_EXTENSIONS = new Set(UPLOAD_ACCEPT.split(','));

type ItemTableColumn = 'article' | 'name' | 'justification' | 'plan' | 'status' | 'approved' | 'difference' | 'comment' | 'files' | 'actions';
type RequestDeletePreviewColumn = 'kind' | 'name' | 'sum';
type RequestDeletePreviewRow = {
  kind: string;
  name: string;
  sum: number;
};

type RequestApprovalAction = {
  step: ApprovalStep;
  child_step_id: string | null;
  request_status: StepStatus;
  can_approve: boolean;
  can_forward: boolean;
  package_request_ids?: string[];
  can_return: boolean;
  is_final: boolean;
};

type RequestApprovalRouteStep = {
  step: ApprovalStep;
  logs: StepLog[];
};

const DEFAULT_ITEM_TABLE_COLUMN_WIDTHS: Record<ItemTableColumn, number> = {
  article: 260,
  name: 220,
  justification: 240,
  plan: 120,
  status: 150,
  approved: 120,
  difference: 180,
  comment: 180,
  files: 230,
  actions: 92,
};

const ITEM_TABLE_COLUMN_MIN_WIDTHS: Record<ItemTableColumn, number> = {
  article: 180,
  name: 160,
  justification: 180,
  plan: 100,
  status: 120,
  approved: 100,
  difference: 150,
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

function hasEffectiveItemChanges(item: BudgetItem, draft: Partial<BudgetItem>) {
  return Object.entries(draft).some(([field, value]) => {
    const original = item[field as keyof BudgetItem];
    if (typeof value === 'number' && typeof original === 'number') return value !== original;
    return value !== original;
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  if (detail) return detail;
  if (error instanceof Error && error.message === 'Network Error') return 'Не удалось подключиться к серверу';
  return detail || (error instanceof Error ? error.message : fallback);
}

type CounterpartyContact = { user_id: string; login: string; role: 'economist' | 'employee'; profile: Profile | null };
type ItemCreatedWithAttachmentError = Error & { itemCreated: true };
type ChatMessage = {
  id: string;
  text: string;
  created_at: string;
  is_system?: boolean;
  sender: { id: string; login: string; role: 'economist' | 'employee'; profile?: Profile | null } | null;
};
type RequestChat = {
  participants: { user_id: string; last_read_message_id: string | null }[];
  messages: ChatMessage[];
};
type RequestLog = {
  id: number;
  created_at: string;
  user: { id: string; login: string; role: User['role']; profile?: Profile | null } | null;
  subject: { type: 'request_line'; name: string | null; article: string | null; category: string | null } | null;
  log: {
    action: string;
    entity: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
};

type CatalogOption = CatalogItem & { label: string };
type DraftChangeHandler = (itemId: string, patch: Partial<BudgetItem>) => void;

const ItemArticleEditor = memo(function ItemArticleEditor({
  articleField,
  catalogById,
  itemId,
  options,
  selectableIds,
  value,
  onDraftChange,
}: {
  articleField: 'dds_id' | 'invest_id';
  catalogById: Map<string, CatalogOption>;
  itemId: string;
  options: CatalogOption[];
  selectableIds: Set<string>;
  value: string | null | undefined;
  onDraftChange: DraftChangeHandler;
}) {
  const selected = value ? catalogById.get(value) || null : null;
  const optionsWithSelected = useMemo(
    () => selected && !selectableIds.has(selected.id) ? [selected, ...options] : options,
    [options, selectableIds, selected],
  );

  return (
    <Autocomplete
      size="small"
      options={optionsWithSelected}
      value={selected}
      onChange={(_, next) => {
        if (next && selectableIds.has(next.id)) onDraftChange(itemId, { [articleField]: next.id });
      }}
      isOptionEqualToValue={(option, selectedOption) => option.id === selectedOption.id}
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) => !selectableIds.has(option.id)}
      renderInput={(params) => (
        <TextField
          {...params}
          label={articleField === 'dds_id' ? 'Статья ДДС' : 'Инвест-проект'}
          placeholder="Поиск по НСИ"
        />
      )}
      sx={{ width: '100%', minWidth: 0 }}
    />
  );
});

const ItemTextEditor = memo(function ItemTextEditor({
  field,
  itemId,
  multiline = false,
  onDraftChange,
  required = false,
  value,
}: {
  field: 'name' | 'justification';
  itemId: string;
  multiline?: boolean;
  onDraftChange: DraftChangeHandler;
  required?: boolean;
  value: string;
}) {
  return (
    <TextField
      size="small"
      required={required}
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      value={value}
      onChange={(event) => onDraftChange(itemId, { [field]: event.target.value })}
      sx={{ width: '100%', minWidth: 0 }}
    />
  );
});

const historyActionLabels: Record<string, string> = {
  created: 'Заявка создана',
  submitted: 'Заявка отправлена на рассмотрение',
  withdrawn: 'Заявка отозвана в черновик',
  cancelled: 'Заявка отменена',
  review_started: 'Начато рассмотрение заявки',
  finalized: 'Рассмотрение заявки завершено',
  reopened: 'Заявка возвращена на рассмотрение',
  frozen: 'Бюджет зафиксирован',
  unfrozen: 'Бюджет разморожен',
  line_created: 'Создана строка заявки',
  line_updated: 'Изменена строка заявки',
  line_deleted: 'Удалена строка заявки',
  file_attached: 'Добавлен файл',
  file_deleted: 'Удалён файл',
  chat_message_sent: 'Отправлено сообщение в чат',
  system_message_sent: 'Отправлено системное сообщение в чат',
};

const historyFieldLabels: Record<string, string> = {
  name: 'Наименование',
  justification: 'Обоснование',
  sum_plan: 'Плановая сумма',
  sum_fact: 'Утверждённая сумма',
  status: 'Статус',
  comment: 'Комментарий',
  frozen: 'Фиксация бюджета',
  fixed: 'Финальная фиксация ЗГД',
  is_income: 'Тип строки',
  dds_id: 'Статья ДДС',
  invest_id: 'Инвест-проект',
  text: 'Текст сообщения',
};

const approvalRouteActionLabels: Record<string, string> = {
  step_created: 'Этап создан',
  step_reopened: 'Этап открыт повторно',
  step_opened: 'Этап открыт для согласования',
  step_approved: 'Этап согласован',
  step_returned: 'Заявка возвращена на доработку',
  step_status_changed: 'Статус этапа изменён',
  approval_graph_closed: 'Маршрут закрыт после фиксации ЗГД',
  approval_request_step_approved: 'Заявка согласована на этапе',
  approval_request_fixed: 'Заявка зафиксирована ЗГД',
  approval_step_opened: 'Этап открыт для согласования',
  approval_step_waiting: 'Этап ожидает предыдущий этап',
  approval_request_forwarded: 'Заявка передана на следующий этап',
  approval_request_returned: 'Заявка возвращена на доработку',
  approval_request_returned_to_employee: 'Заявка возвращена сотруднику на доработку',
  approval_request_reopened_for_revision: 'Заявка направлена на доработку',
  approval_request_revision_accepted: 'Заявка принята после доработки',
  approval_request_final_revoked: 'Финальное согласование ЗГД отменено',
  approval_economist_review_resumed: 'Экономист возобновил рассмотрение заявки',
};

function approvalActionLabel(action: string) {
  return approvalRouteActionLabels[action] || 'Состояние согласования изменено';
}

const technicalHistoryFields = new Set([
  'id', 'item_id', 'request_id', 'req_id', 'unit_id', 'economist_id', 'created_at', 'updated_at',
]);

function historyActorName(actor: RequestLog['user']) {
  if (!actor) return 'Неизвестный пользователь';
  const profile = actor.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || actor.login;
}

function approvalUserName(user: User | null) {
  if (!user) return 'Не назначен';
  const profile = user.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || user.login;
}

function approvalUserContacts(user: User | null) {
  if (!user?.profile) return 'Контакты не указаны';
  const parts = [
    user.profile.phone,
    user.profile.email,
    user.profile.max_link ? `Max: ${user.profile.max_link}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Контакты не указаны';
}

function approvalStepTitle(step: ApprovalStep) {
  if (step.unit_id) {
    const unitName = [step.cfo?.name || step.unit_path.at(-2), step.unit?.name || step.unit_path.at(-1)]
      .filter(Boolean)
      .join(' / ') || 'Модуль';
    return `Экономист · ${unitName}`;
  }
  return step.user?.role === 'zgd' ? 'ЗГД' : `Согласующий · ${approvalUserName(step.user)}`;
}

function approvalRouteStepState(status: StepStatus | undefined): 'completed' | 'active' | 'pending' {
  if (status === 'approved' || status === 'closed') return 'completed';
  if (status === 'on_approval' || status === 'on_revision') return 'active';
  return 'pending';
}

function approvalRouteActiveIndex(route: RequestApprovalRouteStep[]) {
  const activeIndex = route.findIndex(({ step }) => approvalRouteStepState(step.request_status || step.status) === 'active');
  if (activeIndex >= 0) return activeIndex;
  let lastCompleted = -1;
  route.forEach(({ step }, index) => {
    if (approvalRouteStepState(step.request_status || step.status) === 'completed') lastCompleted = index;
  });
  if (lastCompleted < 0) return 0;
  return Math.min(lastCompleted + 1, route.length - 1);
}

function ApprovalRouteStepper({
  route,
  orientation,
}: {
  route: RequestApprovalRouteStep[];
  orientation: 'horizontal' | 'vertical';
}) {
  return (
    <Box className={`approval-route-stepper approval-route-stepper--${orientation}`} role="list">
      {route.map(({ step }, index) => {
        const state = approvalRouteStepState(step.request_status || step.status);
        const prevCompleted = index > 0
          && approvalRouteStepState(route[index - 1].step.request_status || route[index - 1].step.status) === 'completed';
        return (
          <Box key={step.id} className={`approval-route-step approval-route-step--${state}`} role="listitem">
            <Box className="approval-route-step-track" aria-hidden>
              <Box className={`approval-route-step-line approval-route-step-line--before${index === 0 ? ' approval-route-step-line--hidden' : ''}${prevCompleted ? ' approval-route-step-line--done' : ''}`} />
              <Box className="approval-route-step-marker">
                {state === 'completed' ? <CheckIcon sx={{ fontSize: 16 }} /> : String(index + 1).padStart(2, '0')}
              </Box>
              <Box className={`approval-route-step-line approval-route-step-line--after${index === route.length - 1 ? ' approval-route-step-line--hidden' : ''}${state === 'completed' ? ' approval-route-step-line--done' : ''}`} />
            </Box>
            <Box className="approval-route-step-copy">
              <Typography className="approval-route-step-name">{approvalUserName(step.user)}</Typography>
              <Typography className="approval-route-step-contacts">{approvalUserContacts(step.user)}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function historyValue(value: unknown, field: string, entity: string, action: string) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') {
    if (field === 'is_income') return value ? 'Доход' : 'Расход';
    return value ? 'Да' : 'Нет';
  }
  if (field === 'sum_plan' || field === 'sum_fact') return money(Number(value));
  if (field === 'status' && typeof value === 'string') {
    if (action.startsWith('approval_')) return stepStatusLabels[value as StepStatus] || requestStatusLabels[value as keyof typeof requestStatusLabels] || value;
    return entity === 'req_item'
      ? itemStatusLabels[value as ItemStatus] || value
      : requestStatusLabels[value as keyof typeof requestStatusLabels] || stepStatusLabels[value as StepStatus] || value;
  }
  if (field === 'frozen') return value ? 'Зафиксирован' : 'Разморожен';
  return String(value);
}

function historyChanges(entry: RequestLog) {
  return Object.entries(entry.log.changes || {})
    .filter(([field]) => !technicalHistoryFields.has(field))
    .map(([field, change]) => ({
      field: historyFieldLabels[field] || 'Параметр заявки',
      from: historyValue(change.from, field, entry.log.entity, entry.log.action),
      to: historyValue(change.to, field, entry.log.entity, entry.log.action),
    }));
}

type HistoryChange = { field: string; from: string; to: string };

function HistoryChangeList({ changes, heading = false }: { changes: HistoryChange[]; heading?: boolean }) {
  return (
    <Stack className="request-history-changes" spacing={0.75}>
      {heading && (
        <Stack className="request-history-changes-heading" direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" fontWeight={700}>Изменения</Typography>
          <Typography variant="caption" color="text.secondary">{changes.length} {changes.length === 1 ? 'поле' : 'поля'}</Typography>
        </Stack>
      )}
      {changes.map((change) => (
        <Box key={change.field} className="request-history-change">
          <Typography className="request-history-change-label" variant="caption" color="text.secondary">{change.field}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="baseline" flexWrap="wrap" useFlexGap>
            <Typography className="request-history-change-old" variant="body2">{change.from}</Typography>
            <Typography variant="caption" color="text.secondary">→</Typography>
            <Typography className="request-history-change-new" variant="body2">{change.to}</Typography>
          </Stack>
        </Box>
      ))}
      {!changes.length && <Typography variant="body2" color="text.secondary">Изменений полей нет.</Typography>}
    </Stack>
  );
}

function contactName(contact: CounterpartyContact) {
  const profile = contact.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || contact.login;
}

function chatSenderName(sender: ChatMessage['sender']) {
  if (!sender) return 'Система';
  const profile = sender.profile;
  return [profile?.last_name, profile?.name].filter(Boolean).join(' ') || sender.login;
}

function chatSenderInitial(sender: ChatMessage['sender']) {
  return chatSenderName(sender).trim().charAt(0).toUpperCase() || '?';
}

function chatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const { data: files = [] } = useQuery({
    queryKey: ['item-files', kind, itemId],
    queryFn: async () => (await api.get<FileAttachment[]>(`/items/${itemId}/files`)).data,
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
            startIcon={<VisibilityOutlinedIcon />}
            onClick={() => setPreviewFile(file)}
            aria-label={`Открыть предпросмотр ${file.original_name}`}
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
      <FilePreviewDialog file={previewFile} open={!!previewFile} onClose={() => setPreviewFile(null)} />
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
  isIncome,
  requestId,
  catalog,
  disabled,
}: {
  kind: 'dds' | 'invest';
  isIncome: boolean;
  requestId: string;
  catalog: CatalogItem[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(() => selectableItems(catalog), [catalog]);
  const toast = useAppToast();
  const [article, setArticle] = useState<CatalogItem | null>(null);
  const [name, setName] = useState('');
  const [sumPlan, setSumPlan] = useState('');
  const [justification, setJustification] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.post<BudgetItem>(`/requests/${requestId}/items`, {
        [kind === 'dds' ? 'dds_id' : 'invest_id']: article?.id,
        is_income: isIncome,
        name,
        sum_plan: Number(sumPlan),
        justification,
      });
      try {
        for (const file of pendingFiles) {
          const form = new FormData();
          form.append('file', file);
          await api.post(`/items/${created.data.id}/files`, form);
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
      setName('');
      setSumPlan('');
      setJustification('');
      setPendingFiles([]);
      queryClient.invalidateQueries({ queryKey: ['request-details', requestId] });
      toast(filesCount ? 'Строка и файлы добавлены' : 'Строка добавлена', 'success');
    },
    onError: (error) => {
      if ((error as Partial<ItemCreatedWithAttachmentError>).itemCreated) {
        setArticle(null);
        setName('');
        setSumPlan('');
        setJustification('');
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
        sx={{ minWidth: { xs: 0, sm: 280 }, width: { xs: '100%', lg: 'auto' }, flex: 1 }}
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
        sx={{ minWidth: { xs: 0, sm: 140 }, width: { xs: '100%', lg: 'auto' } }}
      />
      <TextField
        label="Наименование"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={disabled}
        sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', lg: 'auto' }, flex: 1 }}
      />
        <Button variant="contained" onClick={() => create.mutate()} disabled={disabled || !article || !name.trim() || Number(sumPlan) <= 0 || create.isPending} sx={{ width: { xs: '100%', lg: 'auto' } }}>
          {isIncome ? 'Добавить доход' : 'Добавить расход'}
        </Button>
      </Stack>
      <TextField
        label="Обоснование"
        value={justification}
        onChange={(event) => setJustification(event.target.value)}
        disabled={disabled}
        multiline
        minRows={2}
      />
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
  isIncome,
  request,
  user,
  items,
  catalog,
}: {
  title: string;
  kind: 'dds' | 'invest';
  isIncome: boolean;
  request: BudgetRequest;
  user: User;
  items: BudgetItem[];
  catalog: CatalogItem[];
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [stagedFilesByItem, setStagedFilesByItem] = useState<Record<string, File[]>>({});
  const [pendingDeletedFileIdsByItem, setPendingDeletedFileIdsByItem] = useState<Record<string, number[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);
  const canEmployeeChange = user.role === 'employee' && request.status === 'draft' && !request.frozen;
  const disabledForEmployee = !canEmployeeChange;
  const employeeCanEdit = canEmployeeChange;
  const canEconomist = user.role === 'economist' && request.status === 'on_review' && !request.frozen;
  const canDeleteItem = user.role === 'employee' && request.status === 'draft' && !request.frozen;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request-details', request.id] });
  const catalogById = useMemo(
    () => new Map(catalog.map((entry) => [entry.id, { ...entry, label: catalogLabel(entry, catalog) }])),
    [catalog],
  );
  const selectableCatalogOptions = useMemo(
    () => selectableItems(catalog).map((entry) => catalogById.get(entry.id)!),
    [catalog, catalogById],
  );
  const selectableCatalogIds = useMemo(
    () => new Set(selectableCatalogOptions.map((entry) => entry.id)),
    [selectableCatalogOptions],
  );
  const updateEmployeeDraft = useCallback<DraftChangeHandler>((itemId, patch) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch },
    }));
  }, []);

  const itemTableDefinitions = useMemo<TableColumnDefinition<BudgetItem, ItemTableColumn>[]>(() => [
    { id: 'actions', label: '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', sortable: false, filterable: false, hideable: false, getValue: () => '' },
    {
      id: 'article',
      label: kind === 'dds' ? '\u0421\u0442\u0430\u0442\u044C\u044F \u0414\u0414\u0421' : '\u0418\u043D\u0432\u0435\u0441\u0442-\u043F\u0440\u043E\u0435\u043A\u0442',
      getValue: (item) => catalog.find((entry) => entry.id === (kind === 'dds' ? item.dds_id : item.invest_id))?.name || '\u0421\u0442\u0430\u0442\u044C\u044F \u041D\u0421\u0418 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430',
    },
    { id: 'name', label: '\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435', getValue: (item) => item.name || '?' },
    { id: 'justification', label: '\u041E\u0431\u043E\u0441\u043D\u043E\u0432\u0430\u043D\u0438\u0435', getValue: (item) => item.justification || '?' },
    { id: 'plan', label: '\u041F\u043B\u0430\u043D', getValue: (item) => money(item.sum_plan), getSortValue: (item) => item.sum_plan },
    { id: 'status', label: '\u0421\u0442\u0430\u0442\u0443\u0441', getValue: (item) => itemStatusLabels[item.status] || item.status },
    { id: 'approved', label: '\u0423\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E', getValue: (item) => money(item.sum_fact), getSortValue: (item) => item.sum_fact ?? -1 },
    {
      id: 'difference',
      label: '\u041A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0430',
      getValue: (item) => item.sum_fact === null || item.sum_fact === undefined ? '?' : money(Number(item.sum_fact) - Number(item.sum_plan)),
      getSortValue: (item) => item.sum_fact === null || item.sum_fact === undefined ? null : Number(item.sum_fact) - Number(item.sum_plan),
    },
    {
      id: 'comment',
      label: '\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439',
      getValue: (item) => item.comment || (item.status === 'rejected' ? '\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F' : '?'),
    },
    { id: 'files', label: '\u0424\u0430\u0439\u043B', sortable: false, filterable: false, getValue: () => '' },
  ], [catalog, kind]);
  const {
    clearColumnFilter: clearItemColumnFilter,
    clearSort: clearItemSort,
    filterOptions: itemFilterOptions,
    filterSearchValues: itemFilterSearchValues,
    hasActiveFilters: hasActiveItemFilters,
    resetFilters: resetItemFilters,
    resetVisibility: resetItemVisibility,
    rows: visibleItems,
    selectedFilterValues: selectedItemFilterValues,
    setAllFilterOptions: setAllItemFilterOptions,
    setFilterSearchValue: setItemFilterSearchValue,
    setSortAscending: setItemSortAscending,
    setSortDescending: setItemSortDescending,
    setVisibleFilterOptions: setItemVisibleFilterOptions,
    sort: itemSort,
    toggleFilterOption: toggleItemFilterOption,
    toggleVisibility: toggleItemVisibility,
    visibility: itemVisibility,
    visibleColumns: visibleItemColumns,
  } = useTableColumnControls({ rows: items, columns: itemTableDefinitions });
  const itemAutoFitValues = useMemo(() => {
    const values = {} as Record<ItemTableColumn, Array<string | number>>;
    itemTableDefinitions.forEach((column) => {
      if (column.id === 'actions') {
        values[column.id] = [column.label, 'Сохранить', 'Удалить'];
        return;
      }
      if (column.id === 'files') {
        values[column.id] = [column.label, 'Файл'];
        return;
      }
      values[column.id] = [
        column.label,
        ...items.map((item) => {
          const value = column.getValue(item);
          return value == null || value === '' ? '—' : String(value);
        }),
      ];
    });
    return values;
  }, [itemTableDefinitions, items]);
  const { columnWidths, resetColumnWidths, resizeColumn, autoFitColumn } = useTableColumnWidths(
    DEFAULT_ITEM_TABLE_COLUMN_WIDTHS,
    ITEM_TABLE_COLUMN_MIN_WIDTHS,
    itemAutoFitValues,
  );
  const fitItemColumn = (columnId: ItemTableColumn) => {
    autoFitColumn(columnId, itemAutoFitValues[columnId] || [columnId]);
  };
  const renderItemHeader = (
    columnId: ItemTableColumn,
    label: string,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={columnId === 'actions' ? 'Действие' : label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={itemSort?.column === columnId ? itemSort.direction : null}
      onSortAscending={() => setItemSortAscending(columnId)}
      onSortDescending={() => setItemSortDescending(columnId)}
      onClearSort={() => clearItemSort(columnId)}
      filterOptions={itemFilterOptions[columnId]}
      selectedFilterValues={selectedItemFilterValues[columnId]}
      filterSearchValue={itemFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setItemFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleItemFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllItemFilterOptions(columnId)}
      onClearColumnFilter={() => clearItemColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setItemVisibleFilterOptions(columnId, false)}
      onResize={(event) => resizeColumn(columnId, event)}
      onAutoFit={() => fitItemColumn(columnId)}
    />
  );
  const renderItemCell = (
    columnId: ItemTableColumn,
    item: BudgetItem,
    local: Partial<BudgetItem>,
    isDeleted: boolean,
    isEditingItem: boolean,
    draftStatus: ItemStatus,
    inactiveCatalogSelection: boolean,
    catalogId: string | null,
    catalogEntry: CatalogItem | undefined,
    validationError: string | null,
    hasDraftChanges: boolean,
    planFactDifference: number | null,
    stagedFiles: File[],
    pendingDeletedFileIds: number[],
  ) => {
    switch (columnId) {
      case 'article':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {isEditingItem && !isDeleted ? (
              <ItemArticleEditor
                articleField={kind === 'dds' ? 'dds_id' : 'invest_id'}
                catalogById={catalogById}
                itemId={item.id}
                options={selectableCatalogOptions}
                selectableIds={selectableCatalogIds}
                value={(kind === 'dds' ? local.dds_id : local.invest_id) || catalogId}
                onDraftChange={updateEmployeeDraft}
              />
            ) : (
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Stack spacing={0.25}>
                  <span>{catalogEntry?.name || 'Статья НСИ недоступна'}</span>
                </Stack>
                {inactiveCatalogSelection && <Chip label="НСИ неактивна" size="small" color="warning" variant="outlined" />}
              </Stack>
            )}
          </TableCell>
        );
      case 'name':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {isEditingItem && !isDeleted ? (
              <ItemTextEditor
                field="name"
                itemId={item.id}
                required
                value={local.name ?? item.name}
                onDraftChange={updateEmployeeDraft}
              />
            ) : item.name || '—'}
          </TableCell>
        );
      case 'justification':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {isEditingItem && !isDeleted ? (
              <ItemTextEditor
                field="justification"
                itemId={item.id}
                multiline
                value={local.justification ?? item.justification}
                onDraftChange={updateEmployeeDraft}
              />
            ) : item.justification || '—'}
          </TableCell>
        );
      case 'plan':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {isEditingItem && !isDeleted ? (
              <TextField
                size="small"
                type="number"
                value={local.sum_plan ?? item.sum_plan}
                onChange={(event) => updateEmployeeDraft(item.id, { sum_plan: Number(event.target.value) })}
                inputProps={{ min: 0 }}
                sx={{ width: '100%', minWidth: 0 }}
              />
            ) : (
              money(item.sum_plan)
            )}
          </TableCell>
        );
      case 'status':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {canEconomist && !isDeleted ? (
              <TextField
                select
                size="small"
                value={local.status || item.status}
                onChange={(event) => {
                  const status = event.target.value as ItemStatus;
                  const next = { ...local, status };
                  if (['on_review', 'rejected', 'deleted'].includes(status)) next.sum_fact = 0;
                  if (status === 'approved') next.sum_fact = item.sum_plan;
                  setDrafts({ ...drafts, [item.id]: next });
                }}
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
        );
      case 'approved':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {canEconomist && !isDeleted ? (
              <TextField
                size="small"
                type="number"
                value={local.sum_fact ?? item.sum_fact ?? ''}
                disabled={draftStatus === 'on_review' || draftStatus === 'rejected' || draftStatus === 'approved' || draftStatus === 'deleted'}
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
        );
      case 'difference':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            <Typography color={planFactDifference === null ? 'text.secondary' : planFactDifference >= 0 ? 'success.main' : 'error.main'}>
              {planFactDifference === null ? '—' : money(planFactDifference)}
            </Typography>
          </TableCell>
        );
      case 'comment':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            {canEconomist && !isDeleted ? (
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
        );
      case 'files':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            <ItemFilesCell
              kind={kind}
              itemId={item.id}
              editing={isEditingItem && !isDeleted}
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
              disabled={saveEmployeeItemChanges.isPending || isDeleted}
            />
          </TableCell>
        );
      case 'actions':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            <Stack direction="row" spacing={0.5} justifyContent="flex-start" alignItems="center">
              {canEconomist && !isDeleted ? (
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
              ) : employeeCanEdit && !isDeleted && (isEditingItem ? (
                <>
                  <FileAttachAction
                    disabled={saveEmployeeItemChanges.isPending}
                    onUpload={(file) => stageFile(item.id, file)}
                  />
                  <Tooltip title="Сохранить изменения строки">
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => saveEmployeeItemChanges.mutate(item.id)}
                        disabled={saveEmployeeItemChanges.isPending}
                        aria-label="Сохранить изменения строки"
                      >
                        <SaveOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Отменить изменения">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => cancelEmployeeEdit(item.id)}
                        disabled={saveEmployeeItemChanges.isPending}
                        aria-label="Отменить изменения"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              ) : !editingItemId ? (
                <>
                  <Tooltip title="Изменить строку">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => setEditingItemId(item.id)}
                      aria-label="Изменить строку"
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canDeleteItem && (
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
                  )}
                </>
              ) : null)}
            </Stack>
          </TableCell>
        );
      default:
        return null;
    }
  };
  const tableWidth = visibleItemColumns.reduce((sum, column) => sum + columnWidths[column.id], 0);

  const headerCell = (column: ItemTableColumn) => ({
    width: itemVisibility[column] ? columnWidths[column] : 0,
    minWidth: itemVisibility[column] ? columnWidths[column] : 0,
    maxWidth: itemVisibility[column] ? columnWidths[column] : 0,
    px: itemVisibility[column] ? 1 : 0,
    py: itemVisibility[column] ? 1 : 0,
    position: 'relative' as const,
    display: itemVisibility[column] ? 'table-cell' : 'none',
  });

  const bodyCellSx = (column: ItemTableColumn, sx: Record<string, unknown> = {}) => ({
    px: 1,
    py: 1,
    display: itemVisibility[column] ? 'table-cell' : 'none',
    ...sx,
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<BudgetItem> }) => api.patch(`/items/${id}`, body),
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
    mutationFn: (itemId: string) => api.delete(`/items/${itemId}`),
    onSuccess: () => {
      refresh();
      toast('Строка удалена', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить строку'), 'error');
    },
  });

  const saveEmployeeItemChanges = useMutation({
    mutationFn: async (itemId: string) => {
      const body = drafts[itemId] || {};
      if (Object.keys(body).length > 0) {
        await api.patch(`/items/${itemId}`, body);
      }
      for (const file of stagedFilesByItem[itemId] || []) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`/items/${itemId}/files`, form);
      }
      for (const fileId of pendingDeletedFileIdsByItem[itemId] || []) {
        await api.delete(`/items/${itemId}/files/${fileId}`);
      }
    },
    onSuccess: (_data, itemId) => {
      setEditingItemId(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      setStagedFilesByItem((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      setPendingDeletedFileIdsByItem((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      refresh();
      queryClient.invalidateQueries({ queryKey: ['item-files', kind] });
      toast('Строка сохранена', 'success');
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось сохранить строку'), 'error');
    },
  });

  const cancelEmployeeEdit = (itemId: string) => {
    setEditingItemId(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    setStagedFilesByItem((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    setPendingDeletedFileIdsByItem((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
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
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="h6">{title}</Typography>
            <TableColumnTools
              columns={itemTableDefinitions}
              visibility={itemVisibility}
              onToggleColumn={toggleItemVisibility}
              onResetColumns={resetItemVisibility}
              onResetFilters={resetItemFilters}
              onResetWidths={resetColumnWidths}
              hasActiveFilters={hasActiveItemFilters}
            />
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title="Сбросить ширину колонок">
              <IconButton
                size="small"
                onClick={resetColumnWidths}
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
              ? 'Для изменения строки нажмите кнопку редактирования в столбце действий. Каждая строка сохраняется отдельно.'
              : 'Строки заявки показаны в режиме просмотра. Редактирование и работа с файлами доступны только сотруднику в черновике.'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Перетаскивайте границы заголовков, чтобы настроить ширину колонок.
        </Typography>
      </Stack>
      {employeeCanEdit && <AddItemForm kind={kind} isIncome={isIncome} requestId={request.id} catalog={catalog} disabled={disabledForEmployee || !!editingItemId} />}
      <TableContainer className="request-items-table">
        <Table size="small" sx={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {visibleItemColumns.map((column) => <col key={column.id} style={{ width: columnWidths[column.id] }} />)}
          </colgroup>
          <TableHead>
            <TableRow>
              {visibleItemColumns.map((column) => {
                switch (column.id) {
                  case 'article':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('article', kind === 'dds' ? 'Статья ДДС' : 'Инвест-проект')}</TableCell>;
                  case 'name':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('name', 'Наименование')}</TableCell>;
                  case 'justification':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('justification', 'Обоснование')}</TableCell>;
                  case 'plan':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('plan', 'План')}</TableCell>;
                  case 'status':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('status', 'Статус')}</TableCell>;
                  case 'approved':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('approved', 'Утверждено')}</TableCell>;
                  case 'difference':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('difference', 'Корректировка')}</TableCell>;
                  case 'comment':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('comment', 'Комментарий')}</TableCell>;
                  case 'files':
                    return <TableCell key={column.id} sx={headerCell(column.id)}>{renderItemHeader('files', 'Файл', { sortable: false, filterable: false })}</TableCell>;
                  case 'actions':
                    return <TableCell key={column.id} sx={headerCell(column.id)} align="center">{renderItemHeader('actions', 'Действия', { sortable: false, filterable: false })}</TableCell>;
                  default:
                    return null;
                }
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleItems.map((item) => {
              const local = drafts[item.id] || {};
              const isDeleted = item.status === 'deleted';
              const isEditingItem = editingItemId === item.id;
              const draftStatus = local.status || item.status;
              const hasDraftChanges = hasEffectiveItemChanges(item, local);
              const catalogId = kind === 'dds' ? item.dds_id : item.invest_id;
              const catalogEntry = catalog.find((entry) => entry.id === catalogId);
              const inactiveCatalogSelection = isInactiveCatalogSelection(catalog, catalogId);
              const stagedFiles = stagedFilesByItem[item.id] || [];
              const pendingDeletedFileIds = pendingDeletedFileIdsByItem[item.id] || [];
              const validationError = reviewValidationError(item, local);
              const planValue = Number(local.sum_plan ?? item.sum_plan);
              const factValue = local.sum_fact !== undefined ? local.sum_fact : item.sum_fact;
              const planFactDifference = factValue === null || factValue === undefined ? null : Number(factValue) - planValue;
              return (
                <TableRow
                  key={item.id}
                  className={[inactiveCatalogSelection && 'inactive-catalog-item', isDeleted && 'deleted-request-item'].filter(Boolean).join(' ')}
                  sx={{
                    ...(inactiveCatalogSelection ? { '& > .MuiTableCell-root': { bgcolor: 'rgba(237, 108, 2, 0.08)' } } : {}),
                    ...(isDeleted ? { '& > .MuiTableCell-root': { bgcolor: 'action.hover', color: 'text.secondary' } } : {}),
                  }}
                >
                  {visibleItemColumns.map((column) => renderItemCell(
                    column.id,
                    item,
                    local,
                    isDeleted,
                    isEditingItem,
                    draftStatus,
                    inactiveCatalogSelection,
                    catalogId ?? null,
                    catalogEntry,
                    validationError,
                    hasDraftChanges,
                    planFactDifference,
                    stagedFiles,
                    pendingDeletedFileIds,
                  ))}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const detailsKey = ['request-details', id];
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<'content' | 'approval'>('content');
  const [confirmAction, setConfirmAction] = useState<'approve-all-items' | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');

  const { data: request, isPending: requestPending } = useQuery({
    queryKey: detailsKey,
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${id}`)).data,
    enabled: !!id,
  });
  const canLoadApprovalAction = ['economist', 'approver', 'zgd'].includes(user.role);
  const { data: approvalAction, isPending: approvalActionPending } = useQuery({
    queryKey: [...detailsKey, 'approval-action', user.id],
    queryFn: async () => (await api.get<RequestApprovalAction | null>(`/requests/${id}/approval-step`)).data,
    enabled: !!id && canLoadApprovalAction,
  });
  const { data: approvalRoute, isPending: approvalRoutePending } = useQuery({
    queryKey: [...detailsKey, 'approval-route'],
    queryFn: async () => (await api.get<RequestApprovalRouteStep[]>(`/requests/${id}/approval-route`)).data,
    enabled: !!id,
  });
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get<Unit[]>('/units')).data,
  });
  const { data: counterparty } = useQuery({
    queryKey: [...detailsKey, 'counterparty-contact'],
    queryFn: async () => (await api.get<CounterpartyContact | null>(`/requests/${id}/counterparty-contact`)).data,
    enabled: !!id && (user.role === 'economist' || user.role === 'employee'),
  });
  const { data: chat } = useQuery({
    queryKey: [...detailsKey, 'chat'],
    queryFn: async () => (await api.get(`/requests/${id}/chat`)).data as RequestChat,
    enabled: !!id,
    retry: false,
  });
  const { data: logs = [] } = useQuery({
    queryKey: [...detailsKey, 'request-logs'],
    queryFn: async () => (await api.get<RequestLog[]>(`/requests/${id}/logs`)).data,
    enabled: !!id,
  });
  const resolvedApprovalRoute = approvalRoute ?? [];
  const contentLogs = useMemo(
    () => logs.filter((entry) => !entry.log.action.startsWith('approval_')),
    [logs],
  );
  const [chatText, setChatText] = useState('');
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatMessages = chat?.messages || [];
  useEffect(() => {
    const container = chatMessagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [chatMessages.length]);
  const markChatRead = useMutation({
    mutationFn: (messageId: string) => api.patch(`/requests/${id}/chat/read`, { last_read_message_id: messageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...detailsKey, 'chat'] }),
  });
  useEffect(() => {
    if (!chatOpen || markChatRead.isPending) return;
    const latestMessageId = chatMessages.at(-1)?.id;
    const participant = chat?.participants.find((item) => item.user_id === user.id);
    if (latestMessageId && participant?.last_read_message_id !== latestMessageId) {
      markChatRead.mutate(latestMessageId);
    }
  }, [chat?.participants, chatMessages, chatOpen, markChatRead, user.id]);
  const openChat = () => setChatOpen(true);
  useEffect(() => {
    if (!request || (!chat && request.status === 'draft') || searchParams.get('chat') !== '1') return;
    openChat();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('chat');
      return next;
    }, { replace: true });
  }, [chat, request?.status, searchParams, setSearchParams]);
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!request?.id || (!chat && request.status === 'draft') || !token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let reconnectDelay = 1_000;

    const connect = () => {
      socket = new WebSocket(requestChatWebSocketUrl(request.id, token));
      socket.onopen = () => {
        reconnectDelay = 1_000;
        queryClient.invalidateQueries({ queryKey: ['request-details', id, 'chat'] });
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === 'chat.message.created') {
            queryClient.invalidateQueries({ queryKey: ['request-details', id, 'chat'] });
          }
        } catch {
          // Ignore malformed websocket messages and wait for the next event.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [chat, id, queryClient, request?.id, request?.status]);
  const sendChatMessage = useMutation({
    mutationFn: () => api.post(`/requests/${id}/chat/messages`, { text: chatText }),
    onSuccess: () => {
      setChatText('');
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'chat'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'logs'] });
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось отправить сообщение'), 'error'),
  });
  const { data: requestItems, isPending: itemsPending } = useQuery({
    queryKey: [...detailsKey, 'items'],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${id}/items`)).data,
    enabled: !!id,
  });
  const resolvedRequestItems = requestItems ?? [];

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
  const approveRequestAtStep = useMutation({
    mutationFn: () => api.post(`/steps/${approvalAction?.step.id}/requests/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-action'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      toast(
        approvalAction?.is_final
          ? 'Заявка окончательно зафиксирована ЗГД'
          : 'Проверка заявки подтверждена. Её можно будет передать дальше только в составе полного пакета.',
        'success',
      );
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось согласовать заявку'), 'error'),
  });
  const forwardApprovalPackage = useMutation({
    mutationFn: () => api.post(`/steps/${approvalAction?.step.id}/approve`, {
      request_ids: approvalAction?.package_request_ids || [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-action'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      toast('Проверенный пакет передан на следующий этап', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось передать пакет дальше'), 'error'),
  });
  const revokeFinalApproval = useMutation({
    mutationFn: () => api.post(`/requests/${id}/revoke-final-approval`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-action'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      toast('Финальное согласование отменено. Заявка возвращена на этап ЗГД.', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось отменить финальное согласование'), 'error'),
  });
  const returnForRevision = useMutation({
    mutationFn: () => api.post(
      `/steps/${approvalAction?.step.id}/return`,
      approvalAction?.step.unit_id
        ? { request_ids: [id], comment: returnComment.trim() }
        : { targets: [{ child_step_id: approvalAction?.child_step_id, request_ids: [id] }], comment: returnComment.trim() },
    ),
    onSuccess: () => {
      setReturnDialogOpen(false);
      setReturnComment('');
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-action'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      toast('Заявка возвращена на доработку', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось вернуть заявку на доработку'), 'error'),
  });
  const resumeEconomistReview = useMutation({
    mutationFn: () => api.post(`/requests/${id}/resume-economist-review`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-action'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      toast('Заявка разморожена и открыта для доработки экономистом', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось разморозить заявку'), 'error'),
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

  const usesInvestProjects = !!units.find((unit) => unit.id === request?.unit_id)?.uses_invest_projects;
  const activeKind = usesInvestProjects ? 'invest' : 'dds';
  const activeCatalog = usesInvestProjects ? investCatalog : ddsCatalog;
  const expenseItems = useMemo(
    () => resolvedRequestItems.filter((item) => !item.is_income && (usesInvestProjects ? !!item.invest_id : !!item.dds_id)),
    [resolvedRequestItems, usesInvestProjects],
  );
  const incomeItems = useMemo(
    () => resolvedRequestItems.filter((item) => item.is_income && (usesInvestProjects ? !!item.invest_id : !!item.dds_id)),
    [resolvedRequestItems, usesInvestProjects],
  );
  const allItems = resolvedRequestItems.filter((item) => item.status !== 'deleted');
  const requestDeletePreviewDefinitions = useMemo<TableColumnDefinition<RequestDeletePreviewRow, RequestDeletePreviewColumn>[]>(() => [
    {
      id: 'kind',
      label: 'Тип',
      getValue: (row) => row.kind,
    },
    {
      id: 'name',
      label: 'Статья / проект',
      getValue: (row) => row.name,
    },
    {
      id: 'sum',
      label: 'План',
      getValue: (row) => money(row.sum),
      getSortValue: (row) => row.sum,
    },
  ], []);
  const requestDeletePreviewRows = useMemo<RequestDeletePreviewRow[]>(() => allItems.map((item) => ({
    kind: usesInvestProjects ? 'Инвест' : 'ДДС',
    name: activeCatalog.find((entry) => entry.id === (usesInvestProjects ? item.invest_id : item.dds_id))?.name || item.name || '',
    sum: item.sum_plan,
  })), [activeCatalog, allItems, usesInvestProjects]);
  const {
    clearColumnFilter: clearRequestDeletePreviewColumnFilter,
    clearSort: clearRequestDeletePreviewSort,
    filterOptions: requestDeletePreviewFilterOptions,
    filterSearchValues: requestDeletePreviewFilterSearchValues,
    hasActiveFilters: hasActiveRequestDeletePreviewFilters,
    resetFilters: resetRequestDeletePreviewFilters,
    resetVisibility: resetRequestDeletePreviewVisibility,
    rows: visibleRequestDeletePreviewRows,
    selectedFilterValues: selectedRequestDeletePreviewFilterValues,
    setAllFilterOptions: setAllRequestDeletePreviewFilterOptions,
    setFilterSearchValue: setRequestDeletePreviewFilterSearchValue,
    setSortAscending: setRequestDeletePreviewSortAscending,
    setSortDescending: setRequestDeletePreviewSortDescending,
    setVisibleFilterOptions: setRequestDeletePreviewVisibleFilterOptions,
    sort: requestDeletePreviewSort,
    toggleFilterOption: toggleRequestDeletePreviewFilterOption,
    toggleVisibility: toggleRequestDeletePreviewVisibility,
    visibility: requestDeletePreviewVisibility,
    visibleColumns: visibleRequestDeletePreviewColumns,
  } = useTableColumnControls({
    rows: requestDeletePreviewRows,
    columns: requestDeletePreviewDefinitions,
  });
  const renderRequestDeletePreviewHeader = (
    columnId: RequestDeletePreviewColumn,
    label: string,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={requestDeletePreviewSort?.column === columnId ? requestDeletePreviewSort.direction : null}
      onSortAscending={() => setRequestDeletePreviewSortAscending(columnId)}
      onSortDescending={() => setRequestDeletePreviewSortDescending(columnId)}
      onClearSort={() => clearRequestDeletePreviewSort(columnId)}
      filterOptions={requestDeletePreviewFilterOptions[columnId]}
      selectedFilterValues={selectedRequestDeletePreviewFilterValues[columnId]}
      filterSearchValue={requestDeletePreviewFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setRequestDeletePreviewFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleRequestDeletePreviewFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllRequestDeletePreviewFilterOptions(columnId)}
      onClearColumnFilter={() => clearRequestDeletePreviewColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setRequestDeletePreviewVisibleFilterOptions(columnId, false)}
    />
  );
  const canSubmit = user.role === 'employee' && request && request.status === 'draft' && !request.frozen && !itemsPending && allItems.length > 0;
  const canCancel = user.role === 'employee' && request && request.status === 'draft' && !request.frozen;
  const canFinalize = user.role === 'economist' && request && request.status === 'on_review' && !request.frozen && !itemsPending && allItems.length > 0 && allItems.every((item) => item.status !== 'on_review');
  const canApproveAllItems = user.role === 'economist' && request && request.status === 'on_review' && !request.frozen && !itemsPending && allItems.some((item) => item.status === 'on_review');
  const isClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status);
  const isHighlightedClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status) && request.status !== 'cancelled';
  const canDelete = !!request && request.status === 'draft' && user.role === 'employee' && !request.frozen;
  const canApproveRequest = !!request && !approvalActionPending && !!approvalAction?.can_approve;
  const canForwardApprovalPackage = !!request && !approvalActionPending && !!approvalAction?.can_forward;
  const canReturnForRevision = !!request
    && !approvalActionPending
    && ['economist', 'approver', 'zgd'].includes(user.role)
    && !!approvalAction?.can_return;
  const canResumeEconomistReview = !!request
    && !approvalActionPending
    && user.role === 'economist'
    && request.frozen
    && approvalAction?.step.unit_id != null
    && approvalAction.request_status === 'on_revision';
  const canRevokeFinalApproval = user.role === 'zgd' && !!request?.fixed;
  const approvalRequestLabel = approvalAction?.is_final ? 'Зафиксировать заявку' : 'Подтвердить проверку';

  const exportRequest = async () => {
    const response = await api.get(`/requests/${id}/export`, { responseType: 'blob' });
    downloadBlob(response.data, `request_${id.slice(0, 8)}.xlsx`);
  };

  if (!id || requestPending || !request) {
    return <Typography>Загрузка заявки...</Typography>;
  }

  // Keep summary visible while a background refetch runs, but avoid mixing ids.
  if (request.id !== id) {
    return <Typography>Загрузка заявки...</Typography>;
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={3}>
        <Card className={`metric-card request-summary-card ${isHighlightedClosed ? 'fixed-request' : ''} ${request.frozen ? 'budget-frozen-card' : ''}`} elevation={0}>
          <CardContent className="request-summary-content">
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} justifyContent="space-between">
                <Stack spacing={1.25}>
                  <Typography variant="h6">Сводка заявки</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <RequestStatusBadge status={request.status} />
                    {request.frozen && <Chip label="Заморожена экономистом" size="small" color="warning" variant="outlined" />}
                    {request.fixed && <Chip label="Зафиксирована ЗГД" size="small" color="success" variant="outlined" />}
                  </Stack>
                </Stack>
                <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                  <Stack className="request-summary-actions" direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                    <Button startIcon={<HistoryOutlinedIcon />} variant="outlined" onClick={() => { setHistoryTab('content'); setHistoryOpen(true); }}>
                      История заявки
                    </Button>
                    {canApproveAllItems && (
                      <Button startIcon={<DoneAllIcon />} variant="contained" onClick={() => setConfirmAction('approve-all-items')}>
                        Зафиксировать все строки
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
                        Согласовать и отправить
                      </Button>
                    )}
                    {canResumeEconomistReview && (
                      <Button
                        startIcon={<RestartAltIcon />}
                        variant="contained"
                        color="warning"
                        onClick={() => resumeEconomistReview.mutate()}
                        disabled={resumeEconomistReview.isPending}
                      >
                        Разморозить и доработать
                      </Button>
                    )}
                    {canApproveRequest && approvalAction && (
                      <Button
                        startIcon={<DoneAllIcon />}
                        variant="contained"
                        onClick={() => approveRequestAtStep.mutate()}
                        disabled={approveRequestAtStep.isPending}
                      >
                        {approvalRequestLabel}
                      </Button>
                    )}
                    {canForwardApprovalPackage && (
                      <Button
                        startIcon={<SendIcon />}
                        variant="contained"
                        onClick={() => forwardApprovalPackage.mutate()}
                        disabled={forwardApprovalPackage.isPending}
                      >
                        Передать дальше
                      </Button>
                    )}
                    {canReturnForRevision && (
                      <Button startIcon={<UndoIcon />} variant="outlined" color="warning" onClick={() => setReturnDialogOpen(true)}>
                        {approvalAction?.step.unit_id ? 'Вернуть сотруднику на доработку' : 'Вернуть на доработку'}
                      </Button>
                    )}
                    {canRevokeFinalApproval && (
                      <Button startIcon={<UndoIcon />} variant="outlined" color="warning" onClick={() => revokeFinalApproval.mutate()} disabled={revokeFinalApproval.isPending}>
                        Отменить согласование
                      </Button>
                    )}
                    {isClosed && (
                      <Button startIcon={<FileDownloadIcon />} variant="outlined" onClick={exportRequest}>
                        Экспорт Excel
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </Stack>
              {request.frozen && (
                <Alert severity="warning" variant="outlined">
                  {request.fixed
                    ? 'Заявка окончательно зафиксирована ЗГД. Данные, строки и файлы больше нельзя изменить.'
                    : 'Заявка заморожена после проверки экономистом и передана по маршруту. Изменения доступны только после возврата на доработку.'}
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

        <Paper className="surface-pad approval-route-paper" elevation={0}>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="h6">Маршрут согласования заявки</Typography>
                <Typography variant="body2" color="text.secondary">
                  Согласующие по маршруту заявки и их контакты.
                </Typography>
              </Box>
              {approvalRoutePending ? (
                <Typography variant="body2" color="text.secondary">Загрузка маршрута согласования…</Typography>
              ) : resolvedApprovalRoute.length > 0 ? (
                <>
                  <Accordion className="approval-route-mobile-accordion" disableGutters elevation={0} defaultExpanded={false}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} className="approval-route-mobile-summary">
                      {(() => {
                        const activeIndex = approvalRouteActiveIndex(resolvedApprovalRoute);
                        const activeStep = resolvedApprovalRoute[activeIndex]?.step;
                        return (
                          <Stack spacing={0.25} minWidth={0}>
                            <Typography variant="body2" fontWeight={700} noWrap>
                              {approvalUserName(activeStep?.user || null)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Шаг {activeIndex + 1} из {resolvedApprovalRoute.length}
                              {activeStep ? ` · ${stepStatusLabels[activeStep.request_status || activeStep.status]}` : ''}
                            </Typography>
                          </Stack>
                        );
                      })()}
                    </AccordionSummary>
                    <AccordionDetails className="approval-route-mobile-details">
                      <ApprovalRouteStepper route={resolvedApprovalRoute} orientation="vertical" />
                    </AccordionDetails>
                  </Accordion>
                  <ApprovalRouteStepper route={resolvedApprovalRoute} orientation="horizontal" />
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">Для заявки пока не создан маршрут согласования.</Typography>
              )}
            </Stack>
        </Paper>

        {counterparty ? (
          <Paper className="surface-pad" elevation={0}>
            <Stack spacing={0.75}>
              <Typography variant="h6">{user.role === 'economist' ? 'Контакты сотрудника объединения' : 'Контакты экономиста'}</Typography>
              <Typography fontWeight={700}>{contactName(counterparty)}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} flexWrap="wrap" useFlexGap>
                <Typography color="text.secondary">Телефон: {counterparty.profile?.phone || 'не указан'}</Typography>
                <Typography color="text.secondary">Электронная почта: {counterparty.profile?.email || 'не указана'}</Typography>
                {counterparty.profile?.max_link ? <Typography color="text.secondary">Max: {counterparty.profile.max_link}</Typography> : null}
              </Stack>
            </Stack>
          </Paper>
        ) : null}

        {!!chat && (user.role === 'employee' || user.role === 'economist') && <Drawer
          anchor="right"
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          PaperProps={{ className: 'request-chat-drawer' }}
        >
          <Stack className="request-chat-header" direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
              <Avatar className="request-chat-header-avatar">{counterparty ? contactName(counterparty).charAt(0).toUpperCase() : 'Ч'}</Avatar>
              <Box minWidth={0}>
                <Typography variant="h6">Чат по заявке</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {counterparty ? `Диалог с ${contactName(counterparty)}` : 'Диалог сотрудника и экономиста'}
                </Typography>
              </Box>
            </Stack>
            <IconButton onClick={() => setChatOpen(false)} aria-label="Закрыть чат"><CloseIcon /></IconButton>
          </Stack>

          <Box ref={chatMessagesRef} className="request-chat-messages" aria-live="polite">
            {!chatMessages.length && (
              <Box className="request-chat-empty">
                <Avatar className="request-chat-empty-avatar">✦</Avatar>
                <Typography fontWeight={700}>Начните обсуждение</Typography>
                <Typography variant="body2" color="text.secondary">Уточняйте детали заявки прямо здесь.</Typography>
              </Box>
            )}
            {chatMessages.map((message, index) => {
              const isSystem = !!message.is_system;
              const isOwn = !isSystem && message.sender?.id === user.id;
              const previousMessage = chatMessages[index - 1];
              const startsNewDay = !previousMessage || chatDayKey(previousMessage.created_at) !== chatDayKey(message.created_at);
              return (
                <Fragment key={message.id}>
                  {startsNewDay && <Box className="chat-day-divider">{chatDayLabel(message.created_at)}</Box>}
                  <Box className={`request-chat-message ${isOwn ? 'request-chat-message-own' : ''} ${isSystem ? 'request-chat-message-system' : ''}`}>
                  {!isOwn && !isSystem && <Avatar className="request-chat-avatar">{chatSenderInitial(message.sender)}</Avatar>}
                  <Box className="request-chat-bubble">
                    {!isOwn && !isSystem && <Typography className="request-chat-sender" variant="caption">{chatSenderName(message.sender)}</Typography>}
                    {isSystem && <Typography className="request-chat-system-label" variant="caption">Системное сообщение</Typography>}
                    <Typography className="request-chat-text">{message.text}</Typography>
                    <Typography className="request-chat-time" variant="caption">{chatTime(message.created_at)}</Typography>
                  </Box>
                  </Box>
                </Fragment>
              );
            })}
          </Box>

          <Box
              component="form"
              className="request-chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (chatText.trim() && !sendChatMessage.isPending) sendChatMessage.mutate();
              }}
            >
              <TextField
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (chatText.trim() && !sendChatMessage.isPending) sendChatMessage.mutate();
                  }
                }}
                placeholder="Напишите сообщение…"
                aria-label="Сообщение в чате"
                fullWidth
                multiline
                minRows={1}
                maxRows={4}
              />
              <Button type="submit" className="request-chat-send" variant="contained" endIcon={<SendIcon />} disabled={!chatText.trim() || sendChatMessage.isPending}>
                Отправить
              </Button>
          </Box>
        </Drawer>}

        <Dialog
          open={returnDialogOpen}
          onClose={() => !returnForRevision.isPending && setReturnDialogOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Вернуть заявку на доработку</DialogTitle>
          <DialogContent>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Комментарий обязателен и будет сохранён в истории заявки.
            </Typography>
            <TextField
              autoFocus
              label="Комментарий ко всей заявке"
              value={returnComment}
              onChange={(event) => setReturnComment(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              required
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setReturnDialogOpen(false)} disabled={returnForRevision.isPending}>Отмена</Button>
            <Button
              variant="contained"
              color="warning"
              startIcon={<UndoIcon />}
              onClick={() => returnForRevision.mutate()}
              disabled={!returnComment.trim() || returnForRevision.isPending}
            >
              Вернуть на доработку
            </Button>
          </DialogActions>
        </Dialog>

        <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)} PaperProps={{ className: 'request-history-drawer' }}>
          <Stack className="request-chat-header" direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="h6">История изменений</Typography>
              <Typography variant="body2" color="text.secondary">Все события по заявке</Typography>
            </Box>
            <IconButton onClick={() => setHistoryOpen(false)} aria-label="Закрыть историю изменений"><CloseIcon /></IconButton>
          </Stack>
          <Tabs
            value={historyTab}
            onChange={(_, value: 'content' | 'approval') => setHistoryTab(value)}
            variant="fullWidth"
            sx={{ px: 1.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="content" label="История содержимого" />
            <Tab value="approval" label="История согласования" />
          </Tabs>
          <Stack sx={{ px: 2.5, overflowY: 'auto' }}>
            {historyTab === 'content' && contentLogs.map((entry) => {
              const changes = historyChanges(entry);
              const isLineChange = !!entry.subject;
              const content = (
                <Stack className="request-history-entry-content" spacing={0.25}>
                  <Typography className="request-history-kind" variant="overline" color="text.secondary" lineHeight={1.2}>{isLineChange ? 'Строка заявки' : 'Заявка'}</Typography>
                  <Typography className="request-history-action" fontWeight={700} lineHeight={1.35}>{historyActionLabels[entry.log.action] || 'Данные заявки изменены'}</Typography>
                  <Typography className="request-history-meta" variant="caption" color="text.secondary">
                    {new Date(entry.created_at).toLocaleString('ru-RU')} · {historyActorName(entry.user)}
                  </Typography>
                  {isLineChange && (
                    <>
                      <Typography className="request-history-subject" variant="body2" sx={{ pt: 0.5 }}>
                        <Box component="span" color="text.secondary">Строка: </Box>
                        <Box component="span" fontWeight={700}>{entry.subject?.name || 'Наименование не указано'}</Box>
                      </Typography>
                      {(entry.subject?.category || entry.subject?.article) && (
                        <Typography className="request-history-context" variant="caption" color="text.secondary">
                          {[entry.subject?.category, entry.subject?.article].filter(Boolean).join(' · ')}
                        </Typography>
                      )}
                    </>
                  )}
                </Stack>
              );

              return isLineChange && changes.length > 0 ? (
                <Accordion key={entry.id} disableGutters elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'transparent', '&:before': { display: 'none' } }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon fontSize="small" />}
                    aria-controls={`request-log-${entry.id}-changes`}
                    id={`request-log-${entry.id}-header`}
                    sx={{ px: 0, py: 1.25, '& .MuiAccordionSummary-content': { my: 0 }, '& .MuiAccordionSummary-content.Mui-expanded': { my: 0 } }}
                  >
                    {content}
                  </AccordionSummary>
                  <AccordionDetails id={`request-log-${entry.id}-changes`} sx={{ px: 0, pt: 0, pb: 1.5 }}>
                    <HistoryChangeList changes={changes} heading />
                  </AccordionDetails>
                </Accordion>
              ) : (
                <Box key={entry.id} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  {content}
                  {!isLineChange && <HistoryChangeList changes={changes} />}
                </Box>
              );
            })}
            {historyTab === 'content' && !contentLogs.length && <Typography sx={{ py: 2 }} color="text.secondary">Изменений пока нет.</Typography>}
            {historyTab === 'approval' && resolvedApprovalRoute
              .flatMap(({ step, logs: stepLogs }) => stepLogs.filter((entry) => entry.log.action !== 'approval_step_waiting').map((entry) => ({ step, entry })))
              .sort((left, right) => new Date(right.entry.created_at).getTime() - new Date(left.entry.created_at).getTime())
              .map(({ step, entry }) => (
                <Box key={`${step.id}:${entry.id}`} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Stack className="request-history-entry-content" spacing={0.25}>
                    <Typography className="request-history-kind" variant="overline" color="text.secondary" lineHeight={1.2}>Согласование заявки</Typography>
                    <Typography className="request-history-action" fontWeight={700} lineHeight={1.35}>
                      {approvalActionLabel(entry.log.action)}
                    </Typography>
                    <Typography className="request-history-meta" variant="caption" color="text.secondary">
                      {new Date(entry.created_at).toLocaleString('ru-RU')} · {approvalUserName(entry.user)}
                    </Typography>
                    <Typography className="request-history-subject" variant="body2" sx={{ pt: 0.5 }}>
                      <Box component="span" color="text.secondary">Этап: </Box>
                      <Box component="span" fontWeight={700}>{approvalStepTitle(step)}</Box>
                    </Typography>
                    {entry.log.comment && (
                      <Typography variant="body2" sx={{ pt: 0.25 }}>
                        <Box component="span" color="text.secondary">Комментарий этапа: </Box>
                        {entry.log.comment}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              ))}
            {historyTab === 'approval' && !approvalRoutePending && !resolvedApprovalRoute.some(({ logs: stepLogs }) => stepLogs.some((entry) => entry.log.action !== 'approval_step_waiting')) && (
              <Typography sx={{ py: 2 }} color="text.secondary">Событий согласования пока нет.</Typography>
            )}
          </Stack>
        </Drawer>

        <Paper className={`surface-pad ${request.frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          {itemsPending ? (
            <Typography color="text.secondary">Загрузка строк заявки…</Typography>
          ) : (
            <ItemsTable title="Резервирование бюджета" kind={activeKind} isIncome={false} request={request} user={user} items={expenseItems} catalog={activeCatalog} />
          )}
        </Paper>
        <Paper className={`surface-pad ${request.frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          {itemsPending ? (
            <Typography color="text.secondary">Загрузка строк заявки…</Typography>
          ) : (
            <ItemsTable title="Доходы объединения" kind={activeKind} isIncome request={request} user={user} items={incomeItems} catalog={activeCatalog} />
          )}
        </Paper>
      </Stack>

      <ConfirmDialog
        open={!!confirmAction}
        title="Зафиксировать все строки?"
        description="Все ещё не рассмотренные строки будут утверждены. Фактическая сумма для них будет принята равной плановой, после чего проверка завершится."
        confirmLabel="Зафиксировать все"
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
            <Stack direction="row" spacing={1} justifyContent="flex-start" alignItems="center" flexWrap="wrap" useFlexGap>
              <TableColumnTools
                columns={requestDeletePreviewDefinitions}
                visibility={requestDeletePreviewVisibility}
                onToggleColumn={toggleRequestDeletePreviewVisibility}
                onResetColumns={resetRequestDeletePreviewVisibility}
                onResetFilters={resetRequestDeletePreviewFilters}
                hasActiveFilters={hasActiveRequestDeletePreviewFilters}
              />
              <Typography variant="body2" color="text.secondary">
                Проверьте строки перед удалением.
              </Typography>
            </Stack>
            <Table size="small" sx={{ width: '100%' }}>
              <TableHead>
                <TableRow>
                  {visibleRequestDeletePreviewColumns.map((column) => {
                    switch (column.id) {
                      case 'kind':
                        return <TableCell key={column.id} sx={{ py: 0.75 }}>{renderRequestDeletePreviewHeader('kind', 'Тип')}</TableCell>;
                      case 'name':
                        return <TableCell key={column.id} sx={{ py: 0.75 }}>{renderRequestDeletePreviewHeader('name', 'Статья / проект')}</TableCell>;
                      case 'sum':
                        return <TableCell key={column.id} sx={{ py: 0.75 }} align="right">{renderRequestDeletePreviewHeader('sum', 'План')}</TableCell>;
                      default:
                        return null;
                    }
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRequestDeletePreviewRows.length > 0 ? visibleRequestDeletePreviewRows.map((row, index) => (
                  <TableRow key={`${row.kind}-${row.name}-${index}`}>
                    {visibleRequestDeletePreviewColumns.map((column) => {
                      switch (column.id) {
                        case 'kind':
                          return <TableCell key={column.id} sx={{ py: 0.75 }}>{row.kind}</TableCell>;
                        case 'name':
                          return <TableCell key={column.id} sx={{ py: 0.75 }}>{row.name}</TableCell>;
                        case 'sum':
                          return <TableCell key={column.id} sx={{ py: 0.75 }} align="right">{money(row.sum)}</TableCell>;
                        default:
                          return null;
                      }
                    })}
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell sx={{ py: 1.5 }} colSpan={visibleRequestDeletePreviewColumns.length || 1} align="center">
                      Ничего не найдено
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
