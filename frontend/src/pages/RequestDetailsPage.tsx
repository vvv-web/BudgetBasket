import AttachFileIcon from '@mui/icons-material/AttachFile';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/Send';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import UndoIcon from '@mui/icons-material/Undo';
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Checkbox from '@mui/material/Checkbox';
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePagedChat } from '../api/usePagedChat';
import { chatDayKey, chatDayLabel } from '../utils/chat';
import { chatWebSocketUrl } from '../api/websocket';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RequestHistoryDrawer } from '../components/request-history/RequestHistoryDrawer';
import { FilePreviewDialog } from '../components/FilePreviewDialog';
import { PageSkeleton } from '../components/PageSkeleton';
import { ChatMessageImages } from '../components/ChatMessageImages';
import { ChatMessageText } from '../components/ChatMessageText';
import { useAppToast } from '../components/Layout';
import { TableColumnHeader, TableColumnResizeHandle, TableColumnTools } from '../components/TableColumnControls';
import { RequestStatusBadge } from '../components/StatusBadge';
import { StatusVisualBadge, StatusVisualCell, rowStatusPresentation } from '../components/approval-register/registryStatusVisual';
import { rowRegistryStatus } from '../components/approval-register/registryConfig';
import type { ApprovalRegisterRow, ApprovalRegisterRowsResponse, ApprovalStep, BudgetItem, BudgetRequest, CatalogItem, FileAttachment, ItemStatus, Profile, StepLog, StepStatus, Unit, User } from '../types';
import { CLOSED_REQUEST_STATUSES } from '../types';
import { downloadBlob } from '../utils/download';
import { AGGREGATE_DISPLAY_LABELS } from '../components/approval-register/registryConfig';
import { itemStatusLabels, money, requestStatusLabels, stepStatusLabels } from '../utils/labels';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';
import { normalizePositiveAmount } from '../utils/validation';
import { AUTH_TOKEN_KEY } from '../utils/session';
import { ANALYTICS_FIELD_KEYS, ANALYTICS_FIELD_LABELS, analyticsFieldValue, canEditItemAnalytics, type AnalyticsFieldKey } from '../utils/analyticsFields';
import { InlineEditMoneyCell, InlineEditTextCell } from '../components/inlineEdit';
import { requestWorkflowRequirement, stepAssignee, workflowPersonName, workflowStageLabel } from '../utils/workflowPresentation';

const UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.xlsx,.docx,.zip';
const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const UPLOAD_EXTENSIONS = new Set(UPLOAD_ACCEPT.split(','));

type ItemTableColumn = 'select' | 'structure' | 'requested' | 'approved' | 'rejected' | 'status' | 'justification' | 'comment' | 'files' | 'actions' | AnalyticsFieldKey;
type BulkItemDecision = 'approved' | 'rejected';
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

type RequestItemCategoryGroup = {
  id: string;
  name: string;
  items: BudgetItem[];
};

type RequestItemArticleGroup = {
  id: string;
  name: string;
  items: BudgetItem[];
  categories: RequestItemCategoryGroup[];
};

type ArticleApprovalTarget = {
  articleId: string;
  name: string;
  items: BudgetItem[];
};

type RequestItemTableRow =
  | { type: 'group'; groupId: string; label: string; items: BudgetItem[]; level: 'article' | 'category'; canApprove: boolean }
  | { type: 'item'; item: BudgetItem };

const ANALYTICS_COLUMN_WIDTHS = ANALYTICS_FIELD_KEYS.reduce((result, key) => {
  result[key] = 140;
  return result;
}, {} as Record<AnalyticsFieldKey, number>);

const DEFAULT_ITEM_TABLE_COLUMN_WIDTHS: Record<ItemTableColumn, number> = {
  select: 40,
  structure: 320,
  requested: 118,
  approved: 126,
  rejected: 118,
  status: 148,
  justification: 200,
  comment: 180,
  files: 88,
  actions: 92,
  ...ANALYTICS_COLUMN_WIDTHS,
};

const ITEM_TABLE_COLUMN_MIN_WIDTHS: Record<ItemTableColumn, number> = {
  select: 40,
  structure: 220,
  requested: 100,
  approved: 100,
  rejected: 100,
  status: 120,
  justification: 160,
  comment: 130,
  files: 72,
  actions: 72,
  ...ANALYTICS_COLUMN_WIDTHS,
};

type FilteredRequestSummary = {
  active: boolean;
  requested: number;
  approved: number;
  count: number;
};

const PENDING_TABLE_CHANGE_SX = {
  bgcolor: 'rgba(245, 158, 11, 0.12)',
  boxShadow: 'inset 3px 0 0 #f59e0b',
};

const PENDING_FIELD_CHANGE_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'rgba(245, 158, 11, 0.16)',
    '& fieldset': { borderColor: '#f59e0b', borderWidth: 2 },
    '&:hover fieldset': { borderColor: '#d97706', borderWidth: 2 },
    '&.Mui-focused fieldset': { borderColor: '#d97706', borderWidth: 2 },
  },
  '& .MuiInputLabel-root': { color: '#b45309' },
};

function itemRequestedAmount(item: BudgetItem) {
  return Number(item.sum_plan || 0);
}

function itemApprovedAmount(item: BudgetItem) {
  if (item.status === 'approved' || item.status === 'approved_with_changes') return Number(item.sum_fact || 0);
  return 0;
}

function itemRejectedAmount(item: BudgetItem) {
  if (item.status === 'rejected') return Number(item.sum_plan || 0);
  if (item.status === 'approved_with_changes') return Math.max(Number(item.sum_plan || 0) - Number(item.sum_fact || 0), 0);
  return 0;
}

function itemPendingAmount(item: BudgetItem) {
  if (item.status === 'on_review') return Number(item.sum_plan || 0);
  return 0;
}

function tableMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.abs(Number(value) || 0));
}

function rejectedMoney(value: number) {
  return tableMoney(value);
}

function groupFinancialTotals(groupItems: BudgetItem[]) {
  const activeItems = groupItems.filter((item) => item.status !== 'deleted');
  const approvedItems = activeItems.filter((item) => item.status === 'approved' || item.status === 'approved_with_changes');
  const rejectedItems = activeItems.filter((item) => item.status === 'rejected');
  return {
    requested: activeItems.reduce((sum, item) => sum + itemRequestedAmount(item), 0),
    approved: activeItems.reduce((sum, item) => sum + itemApprovedAmount(item), 0),
    rejected: activeItems.reduce((sum, item) => sum + itemRejectedAmount(item), 0),
    pending: activeItems.reduce((sum, item) => sum + itemPendingAmount(item), 0),
    total: activeItems.length,
    pendingCount: activeItems.length - approvedItems.length - rejectedItems.length,
    rejectedCount: rejectedItems.length,
  };
}

function groupAggregateStatus(groupItems: BudgetItem[]) {
  const totals = groupFinancialTotals(groupItems);
  if (!totals.total) return 'no_data' as const;
  if (totals.pendingCount === 0 && totals.rejectedCount === 0) return 'approved' as const;
  if (totals.pendingCount === 0 && totals.rejectedCount === totals.total) return 'rejected' as const;
  if (totals.pendingCount === totals.total) return 'on_review' as const;
  return 'in_progress' as const;
}

const ITEM_TABLE_COLUMNS = Object.keys(DEFAULT_ITEM_TABLE_COLUMN_WIDTHS) as ItemTableColumn[];
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function normalizeMonthAmount(value: string): string {
  return value.replace(',', '.').replace(/^0+(?=\d)/, '');
}

function monthAmountError(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('-')) return 'Сумма не может быть отрицательной';
  if (!/^\d*(?:\.\d*)?$/.test(value)) return 'Введите неотрицательную сумму';
  if ((value.split('.')[1] || '').length > 2) return 'Допустимо не более двух знаков после запятой';
  if ((value.split('.')[0] || '0').length > 12) return 'Сумма превышает NUMERIC(14,2)';
  return null;
}

function monthAmountToCents(value: string): bigint {
  const [whole = '0', fraction = ''] = (value || '0').split('.');
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
}

function monthPlansTotal(values: string[]): bigint {
  return values.reduce((total, value) => total + (monthAmountError(value) ? 0n : monthAmountToCents(value)), 0n);
}

function centsToAmount(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function annualTotalLabel(value: bigint): string {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value / 100n))},${(value % 100n).toString().padStart(2, '0')} ₽`;
}

function completeMonthPlans(plans: BudgetItem['month_plans'] | undefined): BudgetItem['month_plans'] {
  return MONTH_NAMES.map((_, index) => ({
    month: index + 1,
    sum_plan: String(plans?.find((plan) => plan.month === index + 1)?.sum_plan ?? '0.00'),
  }));
}

function redistributeMonthPlans(plans: BudgetItem['month_plans'], target: bigint): BudgetItem['month_plans'] {
  const current = completeMonthPlans(plans);
  const source = current.map((plan) => monthAmountToCents(String(plan.sum_plan)));
  const total = source.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return current;
  const portions = source.map((value, index) => ({ index, value: value * target / total, remainder: value * target % total }));
  let remaining = target - portions.reduce((sum, item) => sum + item.value, 0n);
  for (const item of [...portions].sort((left, right) => right.remainder === left.remainder ? left.index - right.index : right.remainder > left.remainder ? 1 : -1)) {
    if (remaining === 0n) break;
    item.value += 1n;
    remaining -= 1n;
  }
  return portions.map((item) => ({ month: item.index + 1, sum_plan: centsToAmount(item.value) }));
}

function evenlyDistributeMonthPlans(target: bigint): BudgetItem['month_plans'] {
  const base = target / 12n;
  let remainder = target % 12n;
  return MONTH_NAMES.map((_, index) => {
    const amount = base + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder -= 1n;
    return { month: index + 1, sum_plan: centsToAmount(amount) };
  });
}

function redistributeUnlockedMonthPlans(
  plans: BudgetItem['month_plans'],
  target: bigint,
  lockedMonths: Set<number>,
): BudgetItem['month_plans'] | null {
  const current = completeMonthPlans(plans);
  const lockedTotal = current.reduce(
    (total, plan) => total + (lockedMonths.has(plan.month) ? monthAmountToCents(String(plan.sum_plan)) : 0n),
    0n,
  );
  if (lockedTotal > target) return null;

  const openMonths = current.filter((plan) => !lockedMonths.has(plan.month));
  const remaining = target - lockedTotal;
  if (openMonths.length === 0) return remaining === 0n ? current : null;
  const openTotal = openMonths.reduce((total, plan) => total + monthAmountToCents(String(plan.sum_plan)), 0n);
  if (openTotal === 0n) {
    const base = remaining / BigInt(openMonths.length);
    let remainder = remaining % BigInt(openMonths.length);
    return current.map((plan) => {
      if (lockedMonths.has(plan.month)) return plan;
      const sum_plan = centsToAmount(base + (remainder > 0n ? 1n : 0n));
      if (remainder > 0n) remainder -= 1n;
      return { ...plan, sum_plan };
    });
  }
  const weightedOpenPlans = redistributeMonthPlans(
    current.map((plan) => lockedMonths.has(plan.month) ? { ...plan, sum_plan: '0.00' } : plan),
    remaining,
  );
  return weightedOpenPlans.map((plan) => lockedMonths.has(plan.month)
    ? current.find((currentPlan) => currentPlan.month === plan.month)!
    : plan);
}

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
  return catalog
    .filter((item) => {
      if (!item.parent_id || !item.is_active) return false;
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

function itemValuesEqual(value: unknown, original: unknown) {
  if (Array.isArray(value) && Array.isArray(original)) {
    return JSON.stringify(value) === JSON.stringify(original);
  }
  return value === original;
}

function hasEffectiveItemChanges(item: BudgetItem, draft: Partial<BudgetItem>) {
  return Object.entries(draft).some(([field, value]) => !itemValuesEqual(value, item[field as keyof BudgetItem]));
}

function hasChangedItemField(item: BudgetItem, draft: Partial<BudgetItem>, field: keyof BudgetItem) {
  return Object.hasOwn(draft, field) && !itemValuesEqual(draft[field], item[field]);
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
  files: FileAttachment[];
};
type RequestChat = {
  id: string;
  participants: { user_id: string; last_read_message_id: string | null }[];
  messages: ChatMessage[];
};
function RedistributionDialog({
  item,
  kind,
  catalog,
  pending,
  onClose,
  onConfirm,
}: {
  item: BudgetItem | null;
  kind: 'dds' | 'invest';
  catalog: CatalogItem[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (item: BudgetItem, catalogId: string) => void;
}) {
  const selectableOptions = useMemo(() => selectableItems(catalog), [catalog]);
  const sourceId = item ? (kind === 'dds' ? item.dds_id : item.invest_id) || null : null;
  const [destinationId, setDestinationId] = useState<string | null>(sourceId);
  const source = catalog.find((entry) => entry.id === sourceId) || null;
  const destination = catalog.find((entry) => entry.id === destinationId) || null;
  const options = useMemo(
    () => source && !selectableOptions.some((entry) => entry.id === source.id) ? [source, ...selectableOptions] : selectableOptions,
    [selectableOptions, source],
  );

  useEffect(() => {
    setDestinationId(sourceId);
  }, [item?.id, sourceId]);

  return (
    <Dialog open={!!item} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Перераспределить строку</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.75 }}>
          <Typography variant="body2" color="text.secondary">
            Выберите новую статью и категорию для строки «{item?.name || 'Без наименования'}». Сумма, обоснование и файлы сохранятся.
          </Typography>
          <TextField
            size="small"
            label="Текущая статья и категория"
            value={source ? catalogLabel(source, catalog) : 'Не указана'}
            disabled
            fullWidth
          />
          <Autocomplete
            autoHighlight
            options={options}
            value={destination}
            onChange={(_, value) => setDestinationId(value?.id || null)}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            getOptionLabel={(option) => catalogLabel(option, catalog)}
            groupBy={(option) => catalog.find((entry) => entry.id === option.parent_id)?.name || 'Без статьи'}
            renderInput={(params) => (
              <TextField {...params} size="small" label="Новая статья и категория" placeholder="Поиск по НСИ" />
            )}
            disabled={pending}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>Отмена</Button>
        <Button
          variant="contained"
          startIcon={<SwapHorizIcon />}
          onClick={() => item && destinationId && onConfirm(item, destinationId)}
          disabled={pending || !destinationId || destinationId === sourceId}
        >
          Перераспределить
        </Button>
      </DialogActions>
    </Dialog>
  );
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

function approvalStepUser(step: ApprovalStep) {
  return step.user || step.responsible;
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
              <Typography className="approval-route-step-name">{approvalUserName(approvalStepUser(step))}</Typography>
              <Typography className="approval-route-step-contacts">{approvalUserContacts(approvalStepUser(step))}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
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
              <span>
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
              </span>
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
      <span>
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
      </span>
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
  const [monthPlanValues, setMonthPlanValues] = useState<string[]>(() => Array(12).fill(''));
  const [lockedMonths, setLockedMonths] = useState<Set<number>>(() => new Set());
  const [redistributionError, setRedistributionError] = useState('');
  const [justification, setJustification] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const annualTotal = monthPlansTotal(monthPlanValues);
  const monthPlanErrors = monthPlanValues.map(monthAmountError);
  const monthPlanCents = (value: string) => monthAmountError(value) ? 0n : monthAmountToCents(value || '0');
  const planTarget = monthAmountError(sumPlan) ? null : monthAmountToCents(sumPlan);
  const planDifference = planTarget === null ? null : planTarget - annualTotal;

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.post<BudgetItem>(`/requests/${requestId}/items`, {
        [kind === 'dds' ? 'dds_id' : 'invest_id']: article?.id,
        is_income: isIncome,
        name,
        sum_plan: centsToAmount(planTarget ?? annualTotal),
        month_plans: monthPlanValues.map((sum_plan, index) => ({ month: index + 1, sum_plan: centsToAmount(monthAmountError(sum_plan) ? 0n : monthAmountToCents(sum_plan)) })),
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
      setMonthPlanValues(Array(12).fill(''));
      setLockedMonths(new Set());
      setRedistributionError('');
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
        setMonthPlanValues(Array(12).fill(''));
        setLockedMonths(new Set());
        setRedistributionError('');
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

  const redistributeByCurrentWeights = () => {
    if (planTarget === null) return;
    const month_plans = redistributeUnlockedMonthPlans(monthPlanValues.map((sum_plan, index) => ({
      month: index + 1,
      sum_plan: centsToAmount(monthAmountError(sum_plan) ? 0n : monthAmountToCents(sum_plan)),
    })), planTarget, lockedMonths);
    if (!month_plans) {
      setRedistributionError('Сумма зафиксированных месяцев больше плановой суммы');
      return;
    }
    setRedistributionError('');
    setMonthPlanValues(month_plans.map((plan) => String(plan.sum_plan)));
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
            label={kind === 'dds' ? 'Статья ДДС и категория' : 'Инвест-проект и категория'}
            placeholder="Поиск по статьям НСИ"
          />
        )}
      />
      <TextField
          label="Плановая сумма для распределения"
          inputProps={{ inputMode: 'decimal' }}
          value={sumPlan}
          onChange={(event) => {
            const next = normalizePositiveAmount(event.target.value);
            setSumPlan(next);
            setRedistributionError('');
            if (!monthAmountError(next)) {
              const current = monthPlanValues.map((sum_plan, index) => ({
                month: index + 1,
                sum_plan: lockedMonths.has(index + 1)
                  ? centsToAmount(monthAmountError(sum_plan) ? 0n : monthAmountToCents(sum_plan))
                  : '0.00',
              }));
              const month_plans = redistributeUnlockedMonthPlans(current, monthAmountToCents(next), lockedMonths);
              if (!month_plans) {
                setRedistributionError('Сумма зафиксированных месяцев больше новой плановой суммы');
                return;
              }
              setMonthPlanValues(month_plans.map((plan) => String(plan.sum_plan)));
            }
          }}
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
        <Button variant="contained" onClick={() => create.mutate()} disabled={disabled || !article || !name.trim() || annualTotal <= 0n || planDifference !== 0n || monthPlanErrors.some(Boolean) || create.isPending} sx={{ width: { xs: '100%', lg: 'auto' } }}>
          {isIncome ? 'Добавить доход' : 'Добавить расход'}
        </Button>
      </Stack>
      <Box component="section" sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>{isIncome ? 'План поступлений по месяцам' : 'План расходов по месяцам'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>Годовая сумма распределяется поровну на 12 месяцев. После ручной корректировки используйте кнопку, чтобы распределить разницу с планом по текущим весам.</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 1.25 }}>
            {MONTH_NAMES.map((month, index) => (
              <Box key={month} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
                <TextField label={month} size="small" inputProps={{ inputMode: 'decimal' }} value={monthPlanValues[index]}
                  error={!!monthPlanErrors[index]} helperText={monthPlanErrors[index] || undefined} disabled={disabled} sx={{ flex: 1 }}
                  onChange={(event) => {
                    const next = monthPlanValues.map((value, itemIndex) => itemIndex === index ? normalizeMonthAmount(event.target.value) : value);
                    setRedistributionError('');
                    setMonthPlanValues(next);
                  }}
                />
                <Tooltip title={lockedMonths.has(index + 1) ? 'Месяц зафиксирован: не менять при распределении' : 'Зафиксировать месяц при распределении'}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={lockedMonths.has(index + 1) ? `Снять фиксацию: ${month}` : `Зафиксировать: ${month}`}
                      disabled={disabled}
                      onClick={() => setLockedMonths((current) => {
                        const next = new Set(current);
                        if (next.has(index + 1)) next.delete(index + 1);
                        else next.add(index + 1);
                        return next;
                      })}
                      sx={{ mt: 0.5 }}
                    >
                      {lockedMonths.has(index + 1) ? <LockOutlinedIcon fontSize="small" color="primary" /> : <LockOpenOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>
          <Typography variant="subtitle1" sx={{ mt: 1.5 }}>Итого за год: {annualTotalLabel(annualTotal)}</Typography>
          {planDifference !== null && planDifference !== 0n && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}>
              <Typography variant="body2" color={planDifference > 0n ? 'success.main' : 'error.main'}>
                Разница с планом: {annualTotalLabel(planDifference < 0n ? -planDifference : planDifference)}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={disabled || annualTotal === 0n}
                onClick={redistributeByCurrentWeights}
              >
                Распределить разницу по текущим весам
              </Button>
            </Stack>
          )}
          {redistributionError && <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>{redistributionError}</Typography>}
      </Box>
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
          PDF, PNG, JPG, XLSX, DOCX, ZIP; до 25 МБ каждый.
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

function IncomeMonthPlanEditor({
  plans,
  disabled,
  onChange,
}: {
  plans: BudgetItem['month_plans'] | undefined;
  disabled: boolean;
  onChange: (plans: BudgetItem['month_plans']) => void;
}) {
  const values = MONTH_NAMES.map((_, index) => String(plans?.find((plan) => plan.month === index + 1)?.sum_plan ?? ''));
  const total = monthPlansTotal(values);
  return (
    <Box sx={{ minWidth: 300 }}>
      <Typography variant="caption" color="text.secondary">План поступлений по месяцам</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1, mt: 0.75 }}>
        {MONTH_NAMES.map((month, index) => {
          const error = monthAmountError(values[index]);
          return <TextField
            key={month}
            size="small"
            label={month}
            value={values[index]}
            inputProps={{ inputMode: 'decimal' }}
            error={!!error}
            helperText={error || undefined}
            disabled={disabled}
            onChange={(event) => {
              const next = values.map((value, valueIndex) => valueIndex === index ? normalizeMonthAmount(event.target.value) : value);
              onChange(next.map((sum_plan, monthIndex) => ({ month: monthIndex + 1, sum_plan: centsToAmount(monthAmountError(sum_plan) ? 0n : monthAmountToCents(sum_plan)) })));
            }}
          />;
        })}
      </Box>
      <Typography variant="body2" sx={{ mt: 1 }}>Итого за год: {annualTotalLabel(total)}</Typography>
    </Box>
  );
}

function requestItemStatusPresentation(item: BudgetItem) {
  const registerItem = item as unknown as ApprovalRegisterRow;
  return rowStatusPresentation(rowRegistryStatus(registerItem), registerItem);
}

function RequestItemMonthPlanEditor({
  isIncome,
  plans,
  savedPlans,
  sumPlan,
  editable,
  onChange,
}: {
  isIncome: boolean;
  plans: BudgetItem['month_plans'];
  savedPlans: BudgetItem['month_plans'] | undefined;
  sumPlan: number;
  editable: boolean;
  onChange: (plans: BudgetItem['month_plans']) => void;
}) {
  const [lockedMonths, setLockedMonths] = useState<Set<number>>(new Set());
  const monthPlans = completeMonthPlans(plans);
  const monthValues = monthPlans.map((plan) => String(plan.sum_plan));
  const monthErrors = monthValues.map(monthAmountError);
  const annualTotal = monthPlansTotal(monthValues);
  const planTarget = monthAmountError(String(sumPlan)) ? null : monthAmountToCents(String(sumPlan));
  const planDifference = planTarget === null ? null : planTarget - annualTotal;

  const changeMonth = (month: number, value: string) => {
    onChange(monthPlans.map((plan) => (
      plan.month === month ? { ...plan, sum_plan: normalizeMonthAmount(value) } : plan
    )));
  };
  const redistributeByCurrentWeights = () => {
    if (planTarget === null) return;
    const next = redistributeUnlockedMonthPlans(monthPlans, planTarget, lockedMonths);
    if (next) onChange(next);
  };

  return (
    <Box component="section" sx={{ width: '100%' }}>
      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
        {isIncome ? 'План поступлений по месяцам' : 'План расходов по месяцам'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
        Годовая сумма распределяется поровну на 12 месяцев. После ручной корректировки используйте кнопку, чтобы распределить разницу с планом по текущим весам.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 1.25 }}>
        {MONTH_NAMES.map((month, index) => {
          const value = monthValues[index];
          const savedValue = String(savedPlans?.find((plan) => plan.month === index + 1)?.sum_plan ?? '0');
          const changed = !itemValuesEqual(value, savedValue);
          return (
            <Box key={month} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
              <TextField
                label={month}
                size="small"
                inputProps={{ inputMode: 'decimal' }}
                value={value}
                error={!!monthErrors[index]}
                helperText={monthErrors[index] || undefined}
                disabled={!editable}
                onChange={(event) => changeMonth(index + 1, event.target.value)}
                sx={{ flex: 1, ...(changed ? PENDING_FIELD_CHANGE_SX : {}) }}
              />
              <Tooltip title={lockedMonths.has(index + 1) ? 'Месяц зафиксирован: не менять при распределении' : 'Зафиксировать месяц при распределении'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={lockedMonths.has(index + 1) ? `Снять фиксацию: ${month}` : `Зафиксировать: ${month}`}
                    disabled={!editable}
                    onClick={() => setLockedMonths((current) => {
                      const next = new Set(current);
                      if (next.has(index + 1)) next.delete(index + 1);
                      else next.add(index + 1);
                      return next;
                    })}
                    sx={{ mt: 0.5 }}
                  >
                    {lockedMonths.has(index + 1) ? <LockOutlinedIcon fontSize="small" color="primary" /> : <LockOpenOutlinedIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          );
        })}
      </Box>
      <Typography variant="subtitle1" sx={{ mt: 1.5 }}>Итого за год: {annualTotalLabel(annualTotal)}</Typography>
      {planDifference !== null && planDifference !== 0n && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}>
          <Typography variant="body2" color={planDifference > 0n ? 'success.main' : 'error.main'}>
            Разница с планом: {annualTotalLabel(planDifference < 0n ? -planDifference : planDifference)}
          </Typography>
          <Button size="small" variant="outlined" disabled={!editable || annualTotal === 0n || monthErrors.some(Boolean)} onClick={redistributeByCurrentWeights}>
            Распределить разницу по текущим весам
          </Button>
        </Stack>
      )}
    </Box>
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
  actionableItemIds,
  revisionItemIds,
  cfoRevisionItemIds,
  focusArticleId,
  focusCategoryId,
  onFilteredSummaryChange,
}: {
  title: string;
  kind: 'dds' | 'invest';
  isIncome: boolean;
  request: BudgetRequest;
  user: User;
  items: BudgetItem[];
  catalog: CatalogItem[];
  actionableItemIds: Set<string>;
  revisionItemIds: Set<string>;
  cfoRevisionItemIds: Set<string>;
  focusArticleId?: string | null;
  focusCategoryId?: string | null;
  onFilteredSummaryChange: (summary: FilteredRequestSummary) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [drafts, setDrafts] = useState<Record<string, Partial<BudgetItem>>>({});
  const [weightTargets, setWeightTargets] = useState<Record<string, string>>({});
  const [stagedFilesByItem, setStagedFilesByItem] = useState<Record<string, File[]>>({});
  const [pendingDeletedFileIdsByItem, setPendingDeletedFileIdsByItem] = useState<Record<string, number[]>>({});
  const [autoFitSnapshots, setAutoFitSnapshots] = useState<Record<string, { month_plans: BudgetItem['month_plans']; sum_fact: number | null | undefined }>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);
  const [redistributionTarget, setRedistributionTarget] = useState<BudgetItem | null>(null);
  const [expandedItemGroups, setExpandedItemGroups] = useState<Set<string>>(new Set());
  const [expandedMonthPlans, setExpandedMonthPlans] = useState<Set<string>>(new Set());
  const [articleApprovalTarget, setArticleApprovalTarget] = useState<ArticleApprovalTarget | null>(null);
  const [selectedItems, setSelectedItems] = useState<Map<string, BudgetItem>>(new Map());
  const [bulkDecision, setBulkDecision] = useState<{ items: BudgetItem[]; decision: BulkItemDecision } | null>(null);
  const [bulkDecisionComment, setBulkDecisionComment] = useState('');
  const canEmployeeEditItem = (item: BudgetItem) => user.role === 'employee'
    && !item.frozen
    && !item.fixed
    && (
      (request.status === 'draft' && !request.frozen)
      || revisionItemIds.has(item.id)
      || cfoRevisionItemIds.has(item.id)
    );
  const canCfoEditMonthPlans = (item: BudgetItem) => user.role === 'employee'
    && !item.frozen
    && !item.fixed
    && request.status === 'on_review'
    && request?.available_actions?.includes('complete_cfo_review') === true
    && !!request.cfo_unit_id
    && (user.unit_ids || []).includes(request.cfo_unit_id)
    && !revisionItemIds.has(item.id)
    && !cfoRevisionItemIds.has(item.id);
  const canEmployeeEditFiles = (item: BudgetItem) => user.role === 'employee'
    && !item.frozen
    && !item.fixed
    && (request.status === 'draft' || revisionItemIds.has(item.id));
  const canEmployeeCreateItems = user.role === 'employee' && request.status === 'draft' && !request.frozen;
  const disabledForEmployee = !canEmployeeCreateItems;
  // Downstream decisions are made from the CFO-position workspace.
  const canEconomist = false;
  const canDeleteItem = (item: BudgetItem) => user.role === 'employee'
    && !request.frozen
    && !request.fixed
    && (request.status === 'draft' || revisionItemIds.has(item.id));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request-details', request.id] });
  const updateEconomistMonthPlans = useCallback((itemId: string, month_plans: BudgetItem['month_plans']) => {
    const total = monthPlansTotal(month_plans.map((plan) => String(plan.sum_plan)));
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], month_plans, sum_fact: Number(centsToAmount(total)) },
    }));
  }, []);
  const autoFitEconomistMonthPlans = useCallback((itemId: string, month_plans: BudgetItem['month_plans'], sumFact: number | null | undefined) => {
    setAutoFitSnapshots((current) => ({
      ...current,
      [itemId]: { month_plans: completeMonthPlans(month_plans), sum_fact: sumFact },
    }));
    updateEconomistMonthPlans(itemId, redistributeMonthPlans(month_plans, monthAmountToCents(String(sumFact ?? 0))));
  }, [updateEconomistMonthPlans]);
  const rollbackAutoFit = useCallback((itemId: string) => {
    const snapshot = autoFitSnapshots[itemId];
    if (!snapshot) return;
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], month_plans: snapshot.month_plans, sum_fact: snapshot.sum_fact },
    }));
    setAutoFitSnapshots((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }, [autoFitSnapshots]);

  const itemTableDefinitions = useMemo<TableColumnDefinition<BudgetItem, ItemTableColumn>[]>(() => [
    { id: 'select', label: '', sortable: false, filterable: false, hideable: false, getValue: () => '' },
    { id: 'structure', label: 'Структура', getValue: (item) => item.name || '—' },
    { id: 'requested', label: 'План, ₽', getValue: (item) => tableMoney(item.sum_plan), getSortValue: (item) => item.sum_plan },
    { id: 'approved', label: 'Факт, ₽', getValue: (item) => tableMoney(item.sum_fact), getSortValue: (item) => item.sum_fact ?? -1 },
    { id: 'rejected', label: 'Корректировка, ₽', getValue: (item) => rejectedMoney(itemRejectedAmount(item)), getSortValue: (item) => itemRejectedAmount(item) },
    { id: 'status', label: 'Статус', getValue: (item) => itemStatusLabels[item.status] || item.status },
    { id: 'justification', label: 'Обоснование', getValue: (item) => item.justification || '—' },
    { id: 'comment', label: 'Комментарий', getValue: (item) => item.comment || (item.status === 'rejected' ? 'Комментарий рекомендуется' : '—') },
    ...ANALYTICS_FIELD_KEYS.map((key) => ({
      id: key,
      label: ANALYTICS_FIELD_LABELS[key],
      defaultVisible: false,
      getValue: (item: BudgetItem) => analyticsFieldValue(item, key) || '—',
    })),
    { id: 'files', label: 'Файлы', sortable: false, filterable: false, getValue: () => '' },
    { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  ], []);
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
  const filteredTotals = useMemo(() => groupFinancialTotals(visibleItems), [visibleItems]);
  const hasAnalyticsFilter = ANALYTICS_FIELD_KEYS.some(
    (key) => selectedItemFilterValues[key] !== null,
  );
  useEffect(() => {
    onFilteredSummaryChange({
      active: hasAnalyticsFilter,
      requested: filteredTotals.requested,
      approved: filteredTotals.approved,
      count: filteredTotals.total,
    });
  }, [
    filteredTotals.approved,
    filteredTotals.requested,
    filteredTotals.total,
    hasAnalyticsFilter,
    onFilteredSummaryChange,
  ]);
  const groupedVisibleItems = useMemo<RequestItemArticleGroup[]>(() => {
    const articles = new Map<string, { name: string; items: BudgetItem[]; categories: Map<string, RequestItemCategoryGroup> }>();
    visibleItems.forEach((item) => {
      const catalogId = kind === 'dds' ? item.dds_id : item.invest_id;
      const category = catalog.find((entry) => entry.id === catalogId);
      const article = category?.parent_id ? catalog.find((entry) => entry.id === category.parent_id) : undefined;
      const articleId = article?.id || category?.id || `unclassified:${catalogId || item.id}`;
      const categoryId = category?.id || `unclassified:${catalogId || item.id}`;
      const articleName = article?.name || category?.name || 'Статья НСИ недоступна';
      const categoryName = category?.name || 'Категория НСИ недоступна';
      const group = articles.get(articleId) || {
        name: articleName,
        items: [],
        categories: new Map<string, RequestItemCategoryGroup>(),
      };
      const categoryGroup = group.categories.get(categoryId) || { id: categoryId, name: categoryName, items: [] };
      categoryGroup.items.push(item);
      group.categories.set(categoryId, categoryGroup);
      group.items.push(item);
      articles.set(articleId, group);
    });
    return [...articles.entries()]
      .map(([id, group]) => ({
        id,
        name: group.name,
        // Keep the current user-defined order within each state, but always show
        // deleted rows after the active ones.
        items: [...group.items].sort((left, right) => Number(left.status === 'deleted') - Number(right.status === 'deleted')),
        categories: [...group.categories.values()]
          .map((categoryGroup) => ({
            ...categoryGroup,
            items: [...categoryGroup.items].sort((left, right) => Number(left.status === 'deleted') - Number(right.status === 'deleted')),
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'ru')),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [catalog, kind, visibleItems]);
  const itemGroupIds = useMemo(
    () => groupedVisibleItems.flatMap((article) => [
      `article:${article.id}`,
      ...article.categories.map((category) => `category:${article.id}:${category.id}`),
    ]),
    [groupedVisibleItems],
  );
  useEffect(() => {
    if (!focusArticleId || !itemGroupIds.includes(`article:${focusArticleId}`)) return;
    const nextIds = [`article:${focusArticleId}`];
    if (focusCategoryId && itemGroupIds.includes(`category:${focusArticleId}:${focusCategoryId}`)) {
      nextIds.push(`category:${focusArticleId}:${focusCategoryId}`);
    }
    setExpandedItemGroups((current) => {
      const next = new Set([...current, ...nextIds]);
      return next.size === current.size ? current : next;
    });
  }, [focusArticleId, focusCategoryId, itemGroupIds]);
  useEffect(() => {
    if (!focusArticleId) return;
    const focusGroupId = focusCategoryId && expandedItemGroups.has(`category:${focusArticleId}:${focusCategoryId}`)
      ? `category:${focusArticleId}:${focusCategoryId}`
      : expandedItemGroups.has(`article:${focusArticleId}`)
        ? `article:${focusArticleId}`
        : null;
    if (!focusGroupId) return;
    const timeout = window.setTimeout(() => {
      document.getElementById(`request-item-group-${focusGroupId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [expandedItemGroups, focusArticleId, focusCategoryId]);
  const itemAutoFitValues = useMemo(() => {
    const values = {} as Record<ItemTableColumn, Array<string | number>>;
    itemTableDefinitions.forEach((column) => {
      if (column.id === 'select') {
        values[column.id] = [''];
        return;
      }
      if (column.id === 'actions') {
        values[column.id] = [column.label, 'Удалить'];
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
    validationError: string | null,
    planFactDifference: number | null,
    stagedFiles: File[],
    pendingDeletedFileIds: number[],
  ) => {
    const pendingCellSx = (field: keyof BudgetItem) => (
      hasChangedItemField(item, local, field) ? PENDING_TABLE_CHANGE_SX : {}
    );
    switch (columnId) {
      case 'select':
        return (
          <TableCell key={columnId} align="center" sx={bodyCellSx(columnId, { py: 0.2 })}>
            <Checkbox
              size="small"
              checked={selectedItems.has(item.id)}
              disabled={!isItemActionable(item)}
              onChange={(_, checked) => setSelectedItems((current) => {
                const next = new Map(current);
                if (checked) next.set(item.id, item);
                else next.delete(item.id);
                return next;
              })}
              sx={{ p: 0.35 }}
              inputProps={{ 'aria-label': `Выбрать ${item.name}` }}
            />
          </TableCell>
        );
      case 'structure':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, { py: 0.2, pl: 2.5, ...pendingCellSx('name') })}>
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ minWidth: 0 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id) && !isDeleted ? (
                <InlineEditTextCell
                  value={local.name ?? item.name}
                  editable
                  ariaLabel="Название строки"
                  tooltip="Нажмите, чтобы изменить название строки"
                  onCommit={(name) => setDrafts((current) => ({
                    ...current,
                    [item.id]: { ...current[item.id], name },
                  }))}
                />
              ) : (
                <Tooltip title={item.name || '—'}>
                  <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name || '—'}
                  </Typography>
                </Tooltip>
              )}
              {inactiveCatalogSelection && <Chip label="НСИ неактивна" size="small" color="warning" variant="outlined" sx={{ mt: 0.25, height: 20, fontSize: 10 }} />}
            </Box>
              {!isDeleted && (
                <Tooltip title={expandedMonthPlans.has(item.id) ? 'Свернуть план по месяцам' : 'Показать план по месяцам'}>
                  <IconButton
                    size="small"
                    onClick={() => setExpandedMonthPlans((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })}
                    aria-label={expandedMonthPlans.has(item.id) ? 'Свернуть план по месяцам' : 'Показать план по месяцам'}
                    aria-expanded={expandedMonthPlans.has(item.id)}
                    sx={{ p: 0.35, flexShrink: 0 }}
                  >
                    <ExpandMoreIcon fontSize="small" sx={{ transform: expandedMonthPlans.has(item.id) ? 'rotate(180deg)' : undefined }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </TableCell>
        );
      case 'justification':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, pendingCellSx('justification'))}>
            {canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id) && !isDeleted ? (
              <InlineEditTextCell
                value={local.justification ?? item.justification}
                editable
                multiline
                ariaLabel="Обоснование"
                tooltip="Нажмите, чтобы изменить обоснование"
                onCommit={(justification) => setDrafts((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], justification },
                }))}
              />
            ) : (item.justification || '—')}
          </TableCell>
        );
      case 'requested':
        return (
          <TableCell key={columnId} align="right" sx={bodyCellSx(columnId, { py: 0.2, ...pendingCellSx('sum_plan') })}>
            {((canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id)) || canCfoEditMonthPlans(item)) && !isDeleted ? (
              <InlineEditMoneyCell
                value={Number(local.sum_plan ?? item.sum_plan)}
                editable
                formatValue={tableMoney}
                parseValue={(raw) => {
                  const amount = Number(raw.replace(/\s/g, '').replace(',', '.'));
                  return Number.isFinite(amount) ? amount : null;
                }}
                validate={(amount) => amount >= 0}
                ariaLabel="Запрошенная сумма"
                tooltip="Нажмите, чтобы изменить запрошенную сумму"
                onCommit={(sum_plan) => {
                  const month_plans = evenlyDistributeMonthPlans(monthAmountToCents(String(sum_plan)));
                  setDrafts((current) => ({
                    ...current,
                    [item.id]: { ...current[item.id], sum_plan, month_plans },
                  }));
                }}
              />
            ) : (
              <Typography variant="body2" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tableMoney(local.sum_plan ?? item.sum_plan)}</Typography>
            )}
          </TableCell>
        );
      case 'status':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, { py: 0.2, ...pendingCellSx('status') })}>
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
              <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                <StatusVisualCell presentation={requestItemStatusPresentation(item)} />
                {item.frozen && !item.fixed && (
                  <Tooltip title="Заморожено: изменение строки недоступно" arrow>
                    <LockOutlinedIcon aria-label="Заморожено" sx={{ fontSize: 16, color: 'info.main', ml: 0.25 }} />
                  </Tooltip>
                )}
              </Stack>
            )}
          </TableCell>
        );
      case 'approved':
        return (
          <TableCell key={columnId} align="right" sx={bodyCellSx(columnId, { py: 0.2, ...pendingCellSx('sum_fact') })}>
            {canEmployeeEditItem(item) && cfoRevisionItemIds.has(item.id) && !isDeleted ? (
              <InlineEditMoneyCell
                value={Number(local.sum_fact ?? item.sum_fact ?? 0)}
                editable
                formatValue={tableMoney}
                parseValue={(raw) => {
                  const amount = Number(raw.replace(/\s/g, '').replace(',', '.'));
                  return Number.isFinite(amount) ? amount : null;
                }}
                validate={(amount) => amount >= 0}
                ariaLabel="Фактическая сумма"
                tooltip="Нажмите, чтобы изменить фактическую сумму"
                onDraftChange={(sum_fact) => setDrafts((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], sum_fact },
                }))}
                saveOnBlur={false}
                onCommit={(sum_fact) => setDrafts((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], sum_fact },
                }))}
              />
            ) : canEconomist && !isDeleted ? (
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
              <Typography variant="body2" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tableMoney(item.sum_fact)}</Typography>
            )}
          </TableCell>
        );
      case 'rejected':
        return (
          <TableCell key={columnId} align="right" sx={bodyCellSx(columnId, { py: 0.2 })}>
            <Typography variant="body2" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: planFactDifference ? 'error.main' : 'inherit' }}>
              {rejectedMoney(cfoRevisionItemIds.has(item.id) && local.sum_fact !== undefined ? planFactDifference ?? 0 : itemRejectedAmount(item))}
            </Typography>
          </TableCell>
        );
      case 'comment':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, pendingCellSx('comment'))}>
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
      case 'analytics_1':
      case 'analytics_2':
      case 'analytics_3':
      case 'analytics_4':
      case 'analytics_5': {
        const value = local[columnId] ?? item[columnId] ?? '';
        const useInlineEditor = canEmployeeEditItem(item)
          && !cfoRevisionItemIds.has(item.id)
          && canEditItemAnalytics(item)
          && !isDeleted;
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, pendingCellSx(columnId))}>
            {useInlineEditor ? (
              <InlineEditTextCell
                value={value}
                editable
                ariaLabel={ANALYTICS_FIELD_LABELS[columnId]}
                tooltip={`Нажмите, чтобы изменить «${ANALYTICS_FIELD_LABELS[columnId]}»`}
                onCommit={(analyticsValue) => setDrafts((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], [columnId]: analyticsValue },
                }))}
              />
            ) : value || '—'}
          </TableCell>
        );
      }
      case 'files':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId, stagedFiles.length > 0 || pendingDeletedFileIds.length > 0 ? PENDING_TABLE_CHANGE_SX : {})}>
            <ItemFilesCell
              kind={kind}
              itemId={item.id}
              editing={canEmployeeEditFiles(item) && !isDeleted}
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
              disabled={saveTableChanges.isPending || isDeleted}
            />
          </TableCell>
        );
      case 'actions':
        return (
          <TableCell key={columnId} sx={bodyCellSx(columnId)}>
            <Stack direction="row" spacing={0.5} justifyContent="flex-start" alignItems="center">
              {canEmployeeCreateItems && !isDeleted && (
                <>
                  <FileAttachAction
                    disabled={saveTableChanges.isPending}
                    onUpload={(file) => stageFile(item.id, file)}
                  />
                  <Tooltip title="Перераспределить в другую статью или категорию">
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => setRedistributionTarget(item)}
                        disabled={saveTableChanges.isPending}
                        aria-label="Перераспределить строку"
                      >
                        <SwapHorizIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {canDeleteItem(item) && (
                    <Tooltip title="Удалить строку">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteTarget(item)}
                          disabled={saveTableChanges.isPending}
                          aria-label="Удалить строку"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
              {canDeleteItem(item) && !canEmployeeCreateItems && !isDeleted && (
                <Tooltip title="Отменить строку">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setDeleteTarget(item)}
                      disabled={saveTableChanges.isPending}
                      aria-label="Отменить строку"
                    >
                      <CancelOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
          </TableCell>
        );
      default:
        return null;
    }
  };
  const tableWidth = visibleItemColumns.reduce((sum, column) => sum + columnWidths[column.id], 0);
  const monthPlanColumnSpan = visibleItemColumns.length;

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

  const hasPendingFileChanges = Object.values(stagedFilesByItem).some((files) => files.length > 0)
    || Object.values(pendingDeletedFileIdsByItem).some((fileIds) => fileIds.length > 0);
  const changedItemDrafts = items.flatMap((item) => {
    const draft = drafts[item.id];
    return draft && hasEffectiveItemChanges(item, draft) ? [{ item, draft }] : [];
  });
  const tableDraftValidationError = changedItemDrafts
    .map(({ item, draft }) => reviewValidationError(item, draft))
    .find(Boolean) || null;
  const saveTableChanges = useMutation({
    mutationFn: async () => {
      for (const { item, draft } of changedItemDrafts) {
        await api.patch(`/items/${item.id}`, draft);
      }
      const itemIds = new Set([
        ...Object.keys(stagedFilesByItem),
        ...Object.keys(pendingDeletedFileIdsByItem),
      ]);
      for (const itemId of itemIds) {
        for (const file of stagedFilesByItem[itemId] || []) {
          const form = new FormData();
          form.append('file', file);
          await api.post(`/items/${itemId}/files`, form);
        }
        for (const fileId of pendingDeletedFileIdsByItem[itemId] || []) {
          await api.delete(`/items/${itemId}/files/${fileId}`);
        }
      }
    },
    onSuccess: () => {
      setDrafts({});
      setAutoFitSnapshots({});
      setWeightTargets({});
      setStagedFilesByItem({});
      setPendingDeletedFileIdsByItem({});
      refresh();
      queryClient.invalidateQueries({ queryKey: ['item-files', kind] });
      toast('Изменения таблицы сохранены', 'success');
    },
    onError: (error) => {
      refresh();
      toast(getErrorMessage(error, 'Не удалось сохранить изменения таблицы'), 'error');
    },
  });
  const cancelTableChanges = () => {
    setDrafts({});
    setAutoFitSnapshots({});
    setWeightTargets({});
    setStagedFilesByItem({});
    setPendingDeletedFileIdsByItem({});
  };

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/items/${itemId}`),
    onSuccess: () => {
      refresh();
      toast('Строка исключена из заявки', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getErrorMessage(error, 'Не удалось удалить строку'), 'error');
    },
  });

  const redistributeItem = useMutation({
    mutationFn: ({ item, catalogId }: { item: BudgetItem; catalogId: string }) => api.patch(
      `/items/${item.id}`,
      { [kind === 'dds' ? 'dds_id' : 'invest_id']: catalogId },
    ),
    onSuccess: () => {
      setRedistributionTarget(null);
      refresh();
      toast('Строка перераспределена', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось перераспределить строку'), 'error'),
  });

  const approveArticleItems = useMutation({
    mutationFn: (target: ArticleApprovalTarget) => api.post(
      `/approval-register/groups/article/${target.articleId}/cfo-decision`,
      { decision: 'approved', comment: '' },
    ),
    onSuccess: () => {
      setArticleApprovalTarget(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      toast('Статья согласована', 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось согласовать статью'), 'error'),
  });

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

  const toggleItemGroup = (groupId: string) => setExpandedItemGroups((current) => {
    const next = new Set(current);
    const article = groupedVisibleItems.find((entry) => `article:${entry.id}` === groupId);
    const categoryGroupIds = article?.categories.map((category) => `category:${article.id}:${category.id}`) || [];

    if (next.has(groupId)) {
      next.delete(groupId);
      categoryGroupIds.forEach((categoryGroupId) => next.delete(categoryGroupId));
    } else {
      next.add(groupId);
      categoryGroupIds.forEach((categoryGroupId) => next.add(categoryGroupId));
    }
    return next;
  });
  const groupTotals = groupFinancialTotals;
  const groupStatus = (groupItems: BudgetItem[]) => {
    if (groupItems.length > 0 && groupItems.every((item) => item.status === 'deleted')) {
      return { label: 'Удалена', color: 'default' as const };
    }
    if (!groupItems.some((item) => item.status !== 'deleted')) {
      return { label: '', color: 'default' as const };
    }
    const aggregateStatus = groupAggregateStatus(groupItems);
    const color = aggregateStatus === 'approved' ? 'success' : aggregateStatus === 'rejected' ? 'error' : aggregateStatus === 'no_data' ? 'default' : 'warning';
    return { label: AGGREGATE_DISPLAY_LABELS[aggregateStatus], color: color as 'success' | 'error' | 'warning' | 'default' };
  };
  const canApproveArticle = request.status === 'on_review' && items.some((item) => actionableItemIds.has(item.id));
  const isItemActionable = (item: BudgetItem) => canApproveArticle && item.status === 'on_review' && actionableItemIds.has(item.id);
  const selectedRows = [...selectedItems.values()];

  const bulkDecideItems = useMutation({
    mutationFn: ({ items: targetItems, decision, comment }: { items: BudgetItem[]; decision: BulkItemDecision; comment: string }) => api.post('/items/cfo-decision/bulk', {
      item_ids: targetItems.map((item) => item.id),
      decision,
      comment,
    }),
    onSuccess: (_data, variables) => {
      setBulkDecision(null);
      setBulkDecisionComment('');
      setSelectedItems(new Map());
      refresh();
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      toast(decisionLabel(variables.decision), 'success');
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось сохранить решение'), 'error'),
  });

  function decisionLabel(decision: BulkItemDecision | undefined) {
    if (decision === 'rejected') return 'Строки отклонены';
    return 'Строки согласованы';
  }
  const renderGroupRow = (
    groupId: string,
    label: string,
    groupItems: BudgetItem[],
    level: 'article' | 'category',
    onApprove?: () => void,
  ) => {
    const expanded = expandedItemGroups.has(groupId);
    const totals = groupTotals(groupItems);
    const status = groupStatus(groupItems);
    const groupLocked = groupItems.length > 0 && groupItems.every((item) => item.frozen || item.fixed);
    const groupFixed = groupLocked && groupItems.every((item) => item.fixed);
    const groupFixedPresentation = groupFixed
      ? rowStatusPresentation(
        rowRegistryStatus({ ...(groupItems[0] as unknown as ApprovalRegisterRow), fixed: true }),
        { ...(groupItems[0] as unknown as ApprovalRegisterRow), fixed: true },
      ).primary
      : null;
    const moneyCellSx = { fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    return (
      <TableRow
        key={groupId}
        id={`request-item-group-${groupId}`}
        className="request-items-group-row"
        sx={{
          '& > .MuiTableCell-root': {
            py: 0.2,
            px: 0.75,
            height: level === 'article' ? 34 : 32,
            bgcolor: level === 'article' ? '#f4f9ff' : '#fff',
            fontSize: 13,
          },
          '&:hover > .MuiTableCell-root': { bgcolor: '#edf6ff' },
        }}
      >
        {visibleItemColumns.map((column) => {
          let content: ReactNode = null;
          if (column.id === 'structure') {
            content = (
              <Stack direction="row" spacing={0.25} alignItems="center" sx={{ pl: level === 'category' ? 1.15 : 0, minWidth: 0 }}>
                <IconButton size="small" onClick={() => toggleItemGroup(groupId)} aria-label={expanded ? 'Свернуть группу' : 'Развернуть группу'} sx={{ p: 0.25 }}>
                  {expanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
                </IconButton>
                <Box minWidth={0}>
                  <Tooltip title={label || '—'}>
                    <Typography variant="body2" fontWeight={level === 'article' ? 700 : 600} noWrap sx={{ fontSize: 13, lineHeight: 1.25 }}>
                      {level === 'article' ? 'Статья' : 'Категория'}: {label}
                    </Typography>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.2 }}>
                    {totals.total} {totals.total === 1 ? 'строка' : totals.total < 5 ? 'строки' : 'строк'}
                  </Typography>
                </Box>
              </Stack>
            );
          } else if (column.id === 'requested') {
            content = <Typography sx={moneyCellSx}>{tableMoney(totals.requested)}</Typography>;
          } else if (column.id === 'approved') {
            content = <Typography sx={moneyCellSx}>{tableMoney(totals.approved)}</Typography>;
          } else if (column.id === 'rejected') {
            content = <Typography sx={{ ...moneyCellSx, color: totals.rejected ? 'error.main' : 'inherit' }}>{rejectedMoney(totals.rejected)}</Typography>;
          } else if (column.id === 'status') {
            content = (
              <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.35} alignItems="center">
                  {status.label && <Chip size="small" label={status.label} color={status.color} variant="outlined" sx={{ height: 22, fontSize: 11, fontWeight: 600 }} />}
                  {groupFixed && groupFixedPresentation ? (
                    <Tooltip title="Окончательно зафиксировано ЗГД" arrow>
                      <Box component="span" sx={{ display: 'inline-flex' }}><StatusVisualBadge spec={groupFixedPresentation} iconOnly /></Box>
                    </Tooltip>
                  ) : groupLocked ? (
                    <Tooltip title="Заморожено: все строки группы недоступны для изменения" arrow>
                      <LockOutlinedIcon aria-label="Группа заморожена" sx={{ fontSize: 16, color: 'info.main', ml: 0.25 }} />
                    </Tooltip>
                  ) : null}
                </Stack>
              </Stack>
            );
          } else if (column.id === 'actions' && onApprove && totals.pendingCount > 0) {
            content = <Button size="small" color="success" sx={{ px: 0.5, minWidth: 0, fontSize: 11 }} onClick={onApprove}>Согласовать</Button>;
          } else if (column.id === 'comment' || column.id === 'justification' || column.id === 'files' || ANALYTICS_FIELD_KEYS.includes(column.id as AnalyticsFieldKey)) {
            content = '—';
          }
          return (
            <TableCell
              key={column.id}
              align={['requested', 'approved', 'rejected'].includes(column.id) ? 'right' : column.id === 'select' ? 'center' : 'left'}
              sx={bodyCellSx(column.id)}
            >
              {content}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };
  const requestItemTableRows = groupedVisibleItems.flatMap<RequestItemTableRow>((article) => {
    const articleGroupId = `article:${article.id}`;
    const rows: RequestItemTableRow[] = [{
      type: 'group',
      groupId: articleGroupId,
      label: article.name,
      items: article.items,
      level: 'article',
      canApprove: article.items.some(isItemActionable),
    }];
    if (!expandedItemGroups.has(articleGroupId)) return rows;
    article.categories.forEach((category) => {
      const categoryGroupId = `category:${article.id}:${category.id}`;
      rows.push({ type: 'group', groupId: categoryGroupId, label: category.name, items: category.items, level: 'category', canApprove: false });
      if (expandedItemGroups.has(categoryGroupId)) rows.push(...category.items.map((item) => ({ type: 'item' as const, item })));
    });
    return rows;
  });

  return (
    <>
      <Stack spacing={1.1}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Typography variant="h6" sx={{ fontSize: { xs: '1.05rem', md: '1.15rem' } }}>{title}</Typography>
          <Stack direction="row" spacing={0.25} flexWrap="wrap" useFlexGap alignItems="center">
            {!!itemGroupIds.length && <>
              <Button size="small" color="inherit" startIcon={<UnfoldMoreIcon sx={{ fontSize: 16 }} />} onClick={() => setExpandedItemGroups(new Set(itemGroupIds))} sx={{ textTransform: 'none', fontWeight: 500, minWidth: 0, px: 0.75, fontSize: 13 }}>
                Развернуть все
              </Button>
              <Button size="small" color="inherit" startIcon={<UnfoldLessIcon sx={{ fontSize: 16 }} />} onClick={() => setExpandedItemGroups(new Set())} sx={{ textTransform: 'none', fontWeight: 500, minWidth: 0, px: 0.75, fontSize: 13 }}>
                Свернуть все
              </Button>
            </>}
            {(changedItemDrafts.length > 0 || hasPendingFileChanges) && (
              <>
                <Tooltip title={tableDraftValidationError || 'Сохранить все изменения таблицы'}>
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SaveOutlinedIcon sx={{ fontSize: 16 }} />}
                      onClick={() => saveTableChanges.mutate()}
                      disabled={!!tableDraftValidationError || saveTableChanges.isPending}
                      sx={{ textTransform: 'none', fontWeight: 600, minWidth: 0, px: 1, fontSize: 13 }}
                    >
                      Сохранить
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<CloseIcon sx={{ fontSize: 16 }} />}
                  onClick={cancelTableChanges}
                  disabled={saveTableChanges.isPending}
                  sx={{ textTransform: 'none', fontWeight: 500, minWidth: 0, px: 0.75, fontSize: 13 }}
                >
                  Отменить
                </Button>
              </>
            )}
            <TableColumnTools
              buttonLabel="Колонки"
              columns={itemTableDefinitions}
              visibility={itemVisibility}
              onToggleColumn={toggleItemVisibility}
              onResetColumns={resetItemVisibility}
              onResetFilters={resetItemFilters}
              onResetWidths={resetColumnWidths}
              hasActiveFilters={hasActiveItemFilters}
            />
          </Stack>
        </Stack>
        {canApproveArticle && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
            Строки сгруппированы по статьям и категориям. Выберите строки или согласуйте всю статью целиком.
          </Typography>
        )}
        {!canApproveArticle && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
            {request.available_actions?.includes('edit_revision')
              ? 'На доработке доступны только строки, возвращённые ответственным ЦФО.'
              : canEmployeeCreateItems
              ? 'Нажмите на значение в ячейке, чтобы изменить строку. Сохраните или отмените все изменения кнопками над таблицей.'
              : 'Строки заявки показаны в режиме просмотра.'}
          </Typography>
        )}
      </Stack>
      {selectedRows.length > 0 && (
        <Paper variant="outlined" sx={{ px: 1.25, py: 0.75, borderColor: 'primary.main', bgcolor: 'primary.50' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <Typography variant="body2" fontWeight={700}>
              Выбрано: {selectedRows.length} {selectedRows.length === 1 ? 'строка' : selectedRows.length < 5 ? 'строки' : 'строк'} · запрошено: {money(selectedRows.reduce((total, item) => total + itemRequestedAmount(item), 0))}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" color="success" onClick={() => setBulkDecision({ items: selectedRows, decision: 'approved' })}>Согласовать</Button>
            <Button size="small" color="error" onClick={() => setBulkDecision({ items: selectedRows, decision: 'rejected' })}>Отклонить</Button>
            <Button size="small" onClick={() => setSelectedItems(new Map())}>Снять выделение</Button>
          </Stack>
        </Paper>
      )}
      {canEmployeeCreateItems && <AddItemForm kind={kind} isIncome={isIncome} requestId={request.id} catalog={catalog} disabled={disabledForEmployee || saveTableChanges.isPending} />}
      <TableContainer
        className="request-items-table"
        component={Paper}
        variant="outlined"
        sx={{ overflowX: 'auto', overflowY: 'visible', borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5 }}
      >
        <Table
          size="small"
          sx={{
            // Fill the available viewport while retaining horizontal scrolling
            // when the configured columns need more room.
            width: `max(100%, ${tableWidth}px)`,
            minWidth: tableWidth,
            tableLayout: 'fixed',
            '& td, & th': { borderRight: '1px solid', borderColor: 'rgba(15, 23, 42, 0.06)', fontSize: 12 },
          }}
        >
          <colgroup>
            {visibleItemColumns.map((column) => <col key={column.id} style={{ width: columnWidths[column.id] }} />)}
          </colgroup>
          <TableHead sx={{ '& .MuiTableCell-root': { bgcolor: '#F8FAFC !important', boxShadow: 'inset 0 -1px 0 rgba(15, 23, 42, 0.08)', py: 0.55, px: 0.75, fontSize: 12, fontWeight: 700, color: 'text.secondary' } }}>
            <TableRow>
              {visibleItemColumns.map((column) => {
                const align = ['requested', 'approved', 'rejected'].includes(column.id)
                  ? 'right'
                  : column.id === 'select'
                    ? 'center'
                    : 'left';
                if (column.id === 'select') {
                  return (
                    <TableCell key={column.id} align={align} sx={headerCell(column.id)}>
                      <Checkbox
                        size="small"
                        checked={selectedRows.length > 0}
                        indeterminate={selectedRows.length > 0}
                        onChange={() => setSelectedItems(new Map())}
                        sx={{ p: 0.35 }}
                        inputProps={{ 'aria-label': 'Снять выделение' }}
                      />
                    </TableCell>
                  );
                }
                return (
                  <TableCell key={column.id} align={align} sx={headerCell(column.id)}>
                    {renderItemHeader(
                      column.id,
                      column.label,
                      ['files', 'actions', 'select'].includes(column.id) ? { sortable: false, filterable: false } : undefined,
                    )}
                    <TableColumnResizeHandle
                      onPointerDown={(event) => resizeColumn(column.id, event)}
                      onDoubleClick={() => fitItemColumn(column.id)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {requestItemTableRows.map((row) => {
              if (row.type === 'group') {
                return renderGroupRow(
                  row.groupId,
                  row.label,
                  row.items,
                  row.level,
                  row.canApprove ? () => setArticleApprovalTarget({
                    articleId: row.groupId.slice('article:'.length),
                    name: row.label,
                    items: row.items,
                  }) : undefined,
                );
              }
              const item = row.item;
              const local = drafts[item.id] || {};
              const isDeleted = item.status === 'deleted';
              const draftStatus = local.status || item.status;
              const catalogId = kind === 'dds' ? item.dds_id : item.invest_id;
              const inactiveCatalogSelection = isInactiveCatalogSelection(catalog, catalogId);
              const stagedFiles = stagedFilesByItem[item.id] || [];
              const pendingDeletedFileIds = pendingDeletedFileIdsByItem[item.id] || [];
              const validationError = reviewValidationError(item, local);
              const planValue = Number(local.sum_plan ?? item.sum_plan);
              const factValue = local.sum_fact !== undefined ? local.sum_fact : item.sum_fact;
              const planFactDifference = factValue === null || factValue === undefined ? null : Number(factValue) - planValue;
              const visibleMonthPlans = local.month_plans ?? item.month_plans ?? [];
              return (
                <Fragment key={item.id}>
                  <TableRow
                    className={[inactiveCatalogSelection && 'inactive-catalog-item', isDeleted && 'deleted-request-item'].filter(Boolean).join(' ')}
                    sx={{
                      '& td': { py: 0.2, px: 0.75, height: 36, bgcolor: '#fff', fontSize: 13 },
                      '&:hover td': { bgcolor: '#f7fbff' },
                      ...(inactiveCatalogSelection ? { '& > .MuiTableCell-root': { bgcolor: 'rgba(237, 108, 2, 0.08)' } } : {}),
                      ...(isDeleted ? { '& > .MuiTableCell-root': { bgcolor: 'action.hover', color: 'text.secondary' } } : {}),
                    }}
                  >
                    {visibleItemColumns.map((column) => renderItemCell(
                      column.id,
                      item,
                      local,
                      isDeleted,
                      false,
                      draftStatus,
                      inactiveCatalogSelection,
                      catalogId ?? null,
                      validationError,
                      planFactDifference,
                      stagedFiles,
                      pendingDeletedFileIds,
                    ))}
                  </TableRow>
                  {!isDeleted && expandedMonthPlans.has(item.id) && (
                    <TableRow>
                      <TableCell colSpan={monthPlanColumnSpan} sx={{ py: 0.8, px: 1.25, bgcolor: '#fff', borderBottom: 1, borderColor: 'divider' }}>
                        <Stack spacing={0.75}>
                          <Box sx={{ width: '100%', maxWidth: { xs: 'calc(100vw - 32px)', lg: 'calc(100vw - 390px)' } }}>
                            <RequestItemMonthPlanEditor
                              isIncome={item.is_income}
                              plans={visibleMonthPlans}
                              savedPlans={item.month_plans}
                              sumPlan={Number(local.sum_plan ?? item.sum_plan)}
                              editable={(canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id)) || canCfoEditMonthPlans(item)}
                              onChange={(month_plans) => setDrafts((current) => ({
                                ...current,
                                [item.id]: { ...current[item.id], month_plans },
                              }))}
                            />
                          </Box>
                          <Box sx={{ display: 'none' }}>
                          <Stack direction="row" alignItems="baseline" spacing={0.5}>
                            <Typography variant="body2" fontWeight={700} sx={{ fontSize: 13 }}>
                              {item.is_income ? 'План поступлений по месяцам' : 'План расходов по месяцам'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                              · {money(Number(monthPlansTotal(visibleMonthPlans.map((plan) => String(plan.sum_plan))) / 100n))}
                            </Typography>
                          </Stack>
                          <Box sx={{
                            width: '100%',
                            // The item table may be wider than the viewport because of
                            // user-selected columns. Keep the monthly plan inside the
                            // visible application area instead of extending the scroll.
                            maxWidth: { xs: 'calc(100vw - 32px)', lg: 'calc(100vw - 390px)' },
                            display: 'grid',
                            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(6, minmax(0, 1fr))' },
                            gap: 0.55,
                          }}>
                            {MONTH_NAMES.map((month, index) => {
                              const plan = visibleMonthPlans.find((entry) => entry.month === index + 1);
                              const savedPlan = (item.month_plans || []).find((entry) => entry.month === index + 1);
                              const monthPlanChanged = Number(plan?.sum_plan ?? 0) !== Number(savedPlan?.sum_plan ?? 0);
                              const displayAmount = tableMoney(Number(plan?.sum_plan ?? 0));
                              return <Box key={month} sx={{ minWidth: 0, minHeight: 31, px: 0.7, py: 0.35, borderRadius: 1.25, bgcolor: monthPlanChanged ? PENDING_TABLE_CHANGE_SX.bgcolor : '#fff', boxShadow: monthPlanChanged ? PENDING_TABLE_CHANGE_SX.boxShadow : '0 1px 2px rgba(15, 23, 42, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: '0 0 34px', fontSize: 12 }}>
                                  {month.slice(0, 3)}
                                </Typography>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                {(canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id)) || canCfoEditMonthPlans(item) ? (
                                  <InlineEditTextCell
                                    value={String(plan?.sum_plan ?? '')}
                                    editable
                                    align="right"
                                    displayValue={displayAmount}
                                    ariaLabel={`План ${month}`}
                                    tooltip={`Нажмите, чтобы изменить план на ${month}`}
                                    onCommit={(next) => {
                                      const nextPlans = completeMonthPlans(visibleMonthPlans).map((entry) => (
                                        entry.month === index + 1
                                          ? { ...entry, sum_plan: normalizeMonthAmount(next) }
                                          : entry
                                      ));
                                      setDrafts((current) => ({
                                        ...current,
                                        [item.id]: { ...current[item.id], month_plans: nextPlans },
                                      }));
                                    }}
                                  />
                                ) : <Typography variant="caption" fontWeight={600} noWrap sx={{ display: 'block', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{displayAmount}</Typography>}
                                </Box>
                              </Box>;
                            })}
                          </Box>
                          {(() => {
                            const currentTotal = monthPlansTotal(visibleMonthPlans.map((plan) => String(plan.sum_plan)));
                            const planTotal = monthAmountToCents(String(local.sum_plan ?? item.sum_plan ?? 0));
                            const difference = planTotal - currentTotal;
                            if (difference === 0n) return null;
                            return (
                              <Typography variant="body2" color={difference > 0n ? 'success.main' : 'error.main'}>
                                Разница с планом: {annualTotalLabel(difference < 0n ? -difference : difference)}
                              </Typography>
                            );
                          })()}
                          {(() => {
                            const currentTotal = monthPlansTotal(visibleMonthPlans.map((plan) => String(plan.sum_plan)));
                            const canEditPlan = ((canEmployeeEditItem(item) && !cfoRevisionItemIds.has(item.id)) || canCfoEditMonthPlans(item));
                            if (!canEditPlan || currentTotal === 0n) return null;
                            const targetValue = weightTargets[item.id] ?? String(local.sum_plan ?? item.sum_plan);
                            const targetError = monthAmountError(targetValue);
                            const targetDifference = targetError ? null : monthAmountToCents(targetValue) - currentTotal;
                            return <Stack spacing={0.45} sx={{ alignSelf: 'flex-start' }}>
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ sm: 'center' }}>
                                <TextField
                                  size="small"
                                  label="Сумма для распределения"
                                  inputProps={{ inputMode: 'decimal' }}
                                  value={targetValue}
                                  error={!!targetError}
                                  helperText={targetError || undefined}
                                  onChange={(event) => setWeightTargets((current) => ({
                                    ...current,
                                    [item.id]: normalizeMonthAmount(event.target.value),
                                  }))}
                                />
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={!!targetError}
                                  onClick={() => {
                                  const target = monthAmountToCents(targetValue);
                                  const month_plans = redistributeMonthPlans(visibleMonthPlans, target);
                                  const sum_plan = Number(centsToAmount(target));
                                  setDrafts((current) => ({
                                    ...current,
                                    [item.id]: { ...current[item.id], month_plans, sum_plan },
                                  }));
                                }}
                                >
                                  Распределить по текущим весам
                                </Button>
                              </Stack>
                              {targetDifference !== null && targetDifference !== 0n && (
                                <Typography variant="body2" color={targetDifference > 0n ? 'success.main' : 'error.main'}>
                                  Разница с суммой для распределения: {annualTotalLabel(targetDifference < 0n ? -targetDifference : targetDifference)}
                                </Typography>
                              )}
                            </Stack>;
                          })()}
                          </Box>
                          {canEconomist && (local.sum_fact !== undefined || draftStatus !== 'on_review') && (() => {
                            const monthTotal = monthPlansTotal(visibleMonthPlans.map((plan) => String(plan.sum_plan)));
                            const approvedTotal = monthAmountToCents(String(factValue ?? 0));
                            const difference = approvedTotal - monthTotal;
                            const snapshot = autoFitSnapshots[item.id];
                            return <Stack direction="row" spacing={0.5} alignItems="center">
                              {difference !== 0n && <>
                                <Typography variant="caption" color={difference > 0n ? 'success.main' : 'error.main'}>Разница: {annualTotalLabel(difference < 0n ? -difference : difference)}</Typography>
                                <Button size="small" variant="outlined" disabled={monthTotal === 0n} onClick={() => autoFitEconomistMonthPlans(item.id, visibleMonthPlans, factValue)}>Автоподбор</Button>
                              </>}
                              {snapshot && <Button size="small" color="inherit" onClick={() => rollbackAutoFit(item.id)}>Откатить</Button>}
                            </Stack>;
                          })()}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDialog
        open={!!bulkDecision}
        title={bulkDecision?.decision === 'rejected' ? 'Отклонить строки' : 'Согласовать строки'}
        description={bulkDecision && (
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Будет обработано строк: {bulkDecision.items.length} · запрошено: {money(bulkDecision.items.reduce((total, item) => total + itemRequestedAmount(item), 0))}
            </Typography>
            <TextField
              autoFocus
              size="small"
              label={bulkDecision.decision === 'rejected' ? 'Комментарий' : 'Комментарий (необязательно)'}
              required={bulkDecision.decision === 'rejected'}
              multiline
              minRows={3}
              value={bulkDecisionComment}
              onChange={(event) => setBulkDecisionComment(event.target.value)}
              fullWidth
            />
          </Stack>
        )}
        confirmLabel={bulkDecideItems.isPending ? 'Сохраняется…' : 'Подтвердить'}
        confirmColor={bulkDecision?.decision === 'rejected' ? 'error' : 'success'}
        pending={bulkDecideItems.isPending}
        onClose={() => { setBulkDecision(null); setBulkDecisionComment(''); }}
        onConfirm={() => bulkDecision && bulkDecideItems.mutate({
          items: bulkDecision.items,
          decision: bulkDecision.decision,
          comment: bulkDecisionComment.trim(),
        })}
      />

      <ConfirmDialog
        open={!!articleApprovalTarget}
        title="Согласовать статью"
        description={articleApprovalTarget && (
          <Stack spacing={0.5}>
            <Typography>Будет согласована вся доступная вам статья «{articleApprovalTarget.name}».</Typography>
            <Typography variant="body2" color="text.secondary">
              В текущей заявке доступно строк: {articleApprovalTarget.items.filter(isItemActionable).length} · запрошено: {money(articleApprovalTarget.items.filter(isItemActionable).reduce((sum, item) => sum + Number(item.sum_plan || 0), 0))}
            </Typography>
          </Stack>
        )}
        confirmLabel={approveArticleItems.isPending ? 'Сохраняется…' : 'Согласовать'}
        confirmColor="success"
        pending={approveArticleItems.isPending}
        onClose={() => setArticleApprovalTarget(null)}
        onConfirm={() => articleApprovalTarget && approveArticleItems.mutate(articleApprovalTarget)}
      />

      <RedistributionDialog
        item={redistributionTarget}
        kind={kind}
        catalog={catalog}
        pending={redistributeItem.isPending}
        onClose={() => setRedistributionTarget(null)}
        onConfirm={(item, catalogId) => redistributeItem.mutate({ item, catalogId })}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget && revisionItemIds.has(deleteTarget.id) ? 'Отменить строку?' : 'Удалить строку?'}
        description={`Строка «${deleteTarget ? catalog.find((entry) => entry.id === (kind === 'dds' ? deleteTarget.dds_id : deleteTarget.invest_id))?.name || '' : ''}» ${deleteTarget && revisionItemIds.has(deleteTarget.id) ? 'будет отменена и исключена из заявки' : 'будет удалена вместе со связями файлов'}.`}
        confirmLabel={deleteTarget && revisionItemIds.has(deleteTarget.id) ? 'Отменить строку' : 'Удалить'}
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
  const [expenseFilteredSummary, setExpenseFilteredSummary] = useState<FilteredRequestSummary>({ active: false, requested: 0, approved: 0, count: 0 });
  const [incomeFilteredSummary, setIncomeFilteredSummary] = useState<FilteredRequestSummary>({ active: false, requested: 0, approved: 0, count: 0 });
  const updateExpenseFilteredSummary = useCallback((summary: FilteredRequestSummary) => setExpenseFilteredSummary((current) => (
    current.active === summary.active
    && current.requested === summary.requested
    && current.approved === summary.approved
    && current.count === summary.count ? current : summary
  )), []);
  const updateIncomeFilteredSummary = useCallback((summary: FilteredRequestSummary) => setIncomeFilteredSummary((current) => (
    current.active === summary.active
    && current.requested === summary.requested
    && current.approved === summary.approved
    && current.count === summary.count ? current : summary
  )), []);
  const focusArticleId = searchParams.get('article_id');
  const focusCategoryId = searchParams.get('category_id');

  const { data: request, isPending: requestPending } = useQuery({
    queryKey: detailsKey,
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${id}`)).data,
    enabled: !!id,
  });
  const { data: approvalRegisterRows } = useQuery({
    queryKey: [...detailsKey, 'approval-register-rows-access', request?.unit_id],
    queryFn: async () => (await api.get<ApprovalRegisterRowsResponse>('/approval-register/rows', {
      params: { module_id: request?.unit_id, request_id: id, page: 1, page_size: 200 },
    })).data,
    enabled: !!request?.unit_id && user.role === 'employee',
    retry: false,
  });
  const canLoadApprovalAction = false;
  const { data: approvalAction, isPending: approvalActionPending } = useQuery({
    queryKey: [...detailsKey, 'approval-action', user.id],
    queryFn: async () => (await api.get<RequestApprovalAction | null>(`/requests/${id}/approval-step`)).data,
    enabled: !!id && canLoadApprovalAction,
  });
  const { data: approvalRouteSteps = [], isPending: approvalRoutePending } = useQuery({
    queryKey: [...detailsKey, 'approval-route'],
    queryFn: async () => (await api.get<ApprovalStep[]>('/approval-route', { params: { request_id: id } })).data,
    enabled: !!id,
    retry: false,
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
  const { data: chat, hasOlder: hasOlderChatMessages, loadOlder: loadOlderChatMessages, loadingOlder: loadingOlderChatMessages, olderError: olderChatError } = usePagedChat<RequestChat>({
    queryKey: [...detailsKey, 'chat'],
    url: `/requests/${id}/chat`,
    enabled: !!id && (chatOpen || searchParams.get('chat') === '1'),
  });
  const [chatText, setChatText] = useState('');
  const [chatImages, setChatImages] = useState<File[]>([]);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatMessages = chat?.messages || [];
  useEffect(() => {
    const container = chatMessagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [chatMessages.at(-1)?.id]);
  const markChatRead = useMutation({
    mutationFn: (messageId: string) => api.patch(`/chats/${chat?.id}/read`, { last_read_message_id: messageId }),
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
    if (!request?.id || !chat || !token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let reconnectDelay = 1_000;

    const connect = () => {
      socket = new WebSocket(chatWebSocketUrl(chat.id, token));
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
  }, [chat, id, queryClient, request?.status]);
  const sendChatMessage = useMutation({
    mutationFn: () => {
      if (!chatImages.length) return api.post(`/chats/${chat!.id}/messages`, { text: chatText.trim() });
      const form = new FormData();
      form.append('text', chatText.trim());
      chatImages.forEach((image) => form.append('images', image));
      return api.post(`/chats/${chat!.id}/messages/images`, form);
    },
    onSuccess: () => {
      setChatText('');
      setChatImages([]);
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
  const resolvedApprovalRoute = useMemo<RequestApprovalRouteStep[]>(() => {
    const requestCfoId = unitById.get(request?.unit_id || '')?.parent_id;
    if (!requestCfoId) return [];
    const byId = new Map(approvalRouteSteps.map((step) => [step.id, step]));
    const route: RequestApprovalRouteStep[] = [];
    let step = approvalRouteSteps.find((entry) => entry.unit_id === requestCfoId);
    const visited = new Set<string>();
    while (step && !visited.has(step.id)) {
      route.push({ step, logs: [] });
      visited.add(step.id);
      step = step.parent_step_ids.map((parentId) => byId.get(parentId)).find((entry): entry is ApprovalStep => Boolean(entry));
    }
    return route;
  }, [approvalRouteSteps, request?.unit_id, unitById]);
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
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
      queryClient.invalidateQueries({ queryKey: ['step-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      if (action === 'restore') {
        toast('Заявка восстановлена в черновик', 'success');
      }
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось изменить статус заявки'), 'error'),
  });
  const sendCfoRevision = useMutation({
    mutationFn: () => api.post<{ revision_item_ids?: string[] }>(`/requests/${id}/complete-cfo-review`),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: detailsKey });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'items'] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'logs'] });
      queryClient.invalidateQueries({ queryKey: ['request-logs', id] });
      queryClient.invalidateQueries({ queryKey: [...detailsKey, 'approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-incoming-requests'] });
      const count = response.data.revision_item_ids?.length || 0;
      toast(
        count
          ? `На доработку ответственному модулю передано строк: ${count}.`
          : 'Проверка ЦФО завершена. Данные переданы на следующий этап.',
        'success',
      );
    },
    onError: (error) => toast(getErrorMessage(error, 'Не удалось передать пакет дальше'), 'error'),
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
  const actionableRequestItemIds = useMemo(
    () => new Set((approvalRegisterRows?.items || [])
      .filter((item) => item.is_cfo_review_actionable)
      .map((item) => item.id)),
    [approvalRegisterRows],
  );
  const revisionRequestItemIds = useMemo(
    () => new Set((approvalRegisterRows?.items || [])
      .filter((item) => item.is_revision_actionable)
      .map((item) => item.id)),
    [approvalRegisterRows],
  );
  const cfoRevisionRequestItemIds = useMemo(
    () => new Set((approvalRegisterRows?.items || [])
      .filter((item) => item.is_cfo_module_revision_actionable)
      .map((item) => item.id)),
    [approvalRegisterRows],
  );
  const canSendCfoRevision = user.role === 'employee'
    && request?.status === 'on_review'
    && request.available_actions?.includes('complete_cfo_review') === true
    && (approvalRegisterRows?.items || []).some((item) => item.is_cfo_revision_pending && item.is_cfo_review_item_allowed !== false)
    && (approvalRegisterRows?.items || []).every((item) => item.is_cfo_review_completable);
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
  const canSubmit = user.role === 'employee'
    && request
    && (request.status === 'draft' || request.available_actions?.includes('submit'))
    && !request.frozen
    && !itemsPending
    && allItems.length > 0;
  const canRestore = user.role === 'employee'
    && request?.status === 'cancelled'
    && request.available_actions?.includes('restore');
  const canFinalize = false;
  const canApproveAllItems = false;
  const isClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status);
  const isHighlightedClosed = !!request && CLOSED_REQUEST_STATUSES.includes(request.status) && request.status !== 'cancelled';
  const canDelete = !!request
    && request.status === 'draft'
    && user.role === 'employee'
    && request.available_actions?.includes('delete')
    && !request.frozen;
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
  const canRevokeFinalApproval = false;
  const approvalRequestLabel = approvalAction?.is_final ? 'Зафиксировать заявку' : 'Подтвердить проверку';

  const exportRequest = async () => {
    const response = await api.get(`/requests/${id}/export`, { responseType: 'blob' });
    downloadBlob(response.data, `request_${id.slice(0, 8)}.xlsx`);
  };

  if (!id || requestPending || !request) {
    return <PageSkeleton variant="details" label="Загрузка заявки" />;
  }

  // Keep summary visible while a background refetch runs, but avoid mixing ids.
  if (request.id !== id) {
    return <PageSkeleton variant="details" label="Загрузка заявки" />;
  }

  const activeRouteStep = resolvedApprovalRoute.length
    ? resolvedApprovalRoute[approvalRouteActiveIndex(resolvedApprovalRoute)]?.step
    : null;
  const requestRequirement = canSendCfoRevision
    ? 'Все строки текущего цикла проверены. Нажмите «Отправить на доработку», чтобы передать выбранные строки ответственному за модуль.'
    : request.status === 'draft' && user.role !== 'employee'
    ? 'Заявка находится в черновике сотрудника и ещё не отправлена на проверку.'
    : request.available_actions?.includes('edit_revision') && user.role !== 'employee'
      ? 'Заявка возвращена на доработку. Ожидаются исправления и повторная отправка сотрудником.'
      : requestWorkflowRequirement(request, activeRouteStep);
  const activeRouteOwner = activeRouteStep ? stepAssignee(activeRouteStep) : null;
  const requestGuidanceSeverity = request.status === 'approved'
    ? 'success'
    : request.status === 'rejected'
      ? 'error'
      : request.status === 'draft' || request.available_actions?.includes('edit_revision')
        ? 'warning'
        : 'info';
  const userMustAct = Boolean(
    (user.role === 'employee' && (
      request.available_actions?.includes('submit')
      || request.available_actions?.includes('edit_revision')
    ))
    || canSendCfoRevision
    || (activeRouteOwner?.id && activeRouteOwner.id === user.id && ['on_approval', 'on_revision'].includes(activeRouteStep?.request_status || activeRouteStep?.status || '')),
  );
  const filteredRequestSummary = {
    active: expenseFilteredSummary.active || incomeFilteredSummary.active,
    requested: (expenseFilteredSummary.active ? expenseFilteredSummary.requested : 0)
      + (incomeFilteredSummary.active ? incomeFilteredSummary.requested : 0),
    approved: (expenseFilteredSummary.active ? expenseFilteredSummary.approved : 0)
      + (incomeFilteredSummary.active ? incomeFilteredSummary.approved : 0),
    count: (expenseFilteredSummary.active ? expenseFilteredSummary.count : 0)
      + (incomeFilteredSummary.active ? incomeFilteredSummary.count : 0),
  };

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
                    {canRestore && (
                      <Button
                        startIcon={<RestartAltIcon />}
                        variant="contained"
                        color="warning"
                        onClick={() => lifecycle.mutate('restore')}
                        disabled={lifecycle.isPending}
                      >
                        Восстановить заявку
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
                        Удалить черновик
                      </Button>
                    )}
                    {canSubmit && (
                      <Button startIcon={<SendIcon />} variant="contained" onClick={() => lifecycle.mutate('submit')}>
                        Отправить заявку
                      </Button>
                    )}
                    {canSendCfoRevision && (
                      <Button
                        startIcon={<SendIcon />}
                        variant="contained"
                        color="warning"
                        onClick={() => sendCfoRevision.mutate()}
                        disabled={sendCfoRevision.isPending}
                      >
                        {sendCfoRevision.isPending ? 'Передаём…' : 'Отправить на доработку'}
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
              <Alert severity={requestGuidanceSeverity} variant={userMustAct ? 'filled' : 'outlined'}>
                <AlertTitle>{userMustAct ? 'Требуется ваше действие' : requestStatusLabels[request.status]}</AlertTitle>
                {requestRequirement}
                {activeRouteStep && request.status === 'on_review' && !request.available_actions?.includes('edit_revision') && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.9 }}>
                    Текущий этап: {workflowStageLabel(activeRouteStep)} · Исполнитель: {workflowPersonName(activeRouteOwner)}
                  </Typography>
                )}
              </Alert>
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
                  <Typography variant="caption" color="text.secondary">
                    {filteredRequestSummary.active ? 'По выбранным строкам' : 'Сумма заявки'}
                  </Typography>
                  <Typography variant="h6">{money(filteredRequestSummary.active ? filteredRequestSummary.requested : request.summary?.planned_sum)}</Typography>
                </Box>
                <Box className="request-summary-metric request-summary-metric-approved">
                  <Typography variant="caption" color="text.secondary">{filteredRequestSummary.active ? 'Утверждено по выбранным' : 'Утверждено'}</Typography>
                  <Typography variant="h6">{money(filteredRequestSummary.active ? filteredRequestSummary.approved : request.summary?.approved_sum)}</Typography>
                </Box>
                <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">{filteredRequestSummary.active ? 'Выбрано строк' : 'Строк'}</Typography>
                  <Typography variant="h6">{filteredRequestSummary.active ? filteredRequestSummary.count : request.summary?.items_count || 0}</Typography>
                </Box>
                {filteredRequestSummary.active && <Box className="request-summary-metric">
                  <Typography variant="caption" color="text.secondary">Всего в заявке</Typography>
                  <Typography variant="h6">{money(request.summary?.planned_sum)}</Typography>
                </Box>}
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
                              {activeStep ? approvalUserName(approvalStepUser(activeStep)) : 'Не назначен'}
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
            {hasOlderChatMessages && <Button size="small" disabled={loadingOlderChatMessages} onClick={() => void loadOlderChatMessages(chatMessagesRef.current)}>{olderChatError ? 'Повторить загрузку сообщений' : 'Предыдущие сообщения'}</Button>}
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
                    <ChatMessageImages files={message.files || []} />
                    <ChatMessageText text={message.text} />
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
                if ((chatText.trim() || chatImages.length) && !sendChatMessage.isPending) sendChatMessage.mutate();
              }}
            >
              <TextField
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if ((chatText.trim() || chatImages.length) && !sendChatMessage.isPending) sendChatMessage.mutate();
                  }
                }}
                placeholder="Напишите сообщение…"
                aria-label="Сообщение в чате"
                fullWidth
                multiline
                minRows={1}
                maxRows={4}
              />
              <IconButton component="label" aria-label="Прикрепить изображения" disabled={sendChatMessage.isPending}>
                <AttachFileIcon />
                <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => {
                  const images = Array.from(event.target.files || []).filter((file) => file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/gif" || file.type === "image/webp");
                  setChatImages((current) => [...current, ...images.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]);
                  event.currentTarget.value = "";
                }} />
              </IconButton>
              {!!chatImages.length && <Box className="chat-pending-images">{chatImages.map((image) => (
                <Chip key={`${image.name}-${image.lastModified}`} size="small" label={image.name} onDelete={() => setChatImages((current) => current.filter((item) => item !== image))} />
              ))}</Box>}
              <Button type="submit" className="request-chat-send" variant="contained" endIcon={<SendIcon />} disabled={(!chatText.trim() && !chatImages.length) || sendChatMessage.isPending}>
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

        <RequestHistoryDrawer
          target={historyOpen && id ? { requestId: id, title: 'История изменений', subtitle: 'Все события по заявке' } : null}
          onClose={() => setHistoryOpen(false)}
          defaultTab={historyTab}
        />

        <Paper className={`surface-pad ${request.frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          {itemsPending ? (
            <Typography color="text.secondary">Загрузка строк заявки…</Typography>
          ) : (
            <ItemsTable title="Резервирование бюджета" kind={activeKind} isIncome={false} request={request} user={user} items={expenseItems} catalog={activeCatalog} actionableItemIds={actionableRequestItemIds} revisionItemIds={revisionRequestItemIds} cfoRevisionItemIds={cfoRevisionRequestItemIds} focusArticleId={focusArticleId} focusCategoryId={focusCategoryId} onFilteredSummaryChange={updateExpenseFilteredSummary} />
          )}
        </Paper>
        <Paper className={`surface-pad ${request.frozen ? 'budget-frozen-surface' : ''}`} elevation={0}>
          {itemsPending ? (
            <Typography color="text.secondary">Загрузка строк заявки…</Typography>
          ) : (
            <ItemsTable title="Доходы объединения" kind={activeKind} isIncome request={request} user={user} items={incomeItems} catalog={activeCatalog} actionableItemIds={actionableRequestItemIds} revisionItemIds={revisionRequestItemIds} cfoRevisionItemIds={cfoRevisionRequestItemIds} focusArticleId={focusArticleId} focusCategoryId={focusCategoryId} onFilteredSummaryChange={updateIncomeFilteredSummary} />
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
        title="Удалить черновик?"
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
        confirmLabel="Удалить черновик"
        confirmColor="error"
        pending={deleteRequest.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteRequest.mutate()}
      />
    </Stack>
  );
}
