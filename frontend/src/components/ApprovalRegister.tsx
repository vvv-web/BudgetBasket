import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SearchIcon from '@mui/icons-material/Search';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { getApiErrorMessage, getDownloadApiErrorMessage } from '../utils/apiErrors';
import { downloadBlob } from '../utils/download';
import { useAppToast, usePageChromeActions, usePageChromeLeading } from './Layout';
import { TableRowsSkeleton } from './PageSkeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { InlineEditMoneyCell, InlineEditTextCell } from './inlineEdit';
import { ArticleRevisionDialog, type RevisionTarget } from './ArticleRevisionDialog';
import { TableColumnHeader, TableColumnResizeHandle, TableColumnTools } from './TableColumnControls';
import {
  canEditApprovedAmount,
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COLUMN_WIDTHS,
  defaultRegistryColumnVisibility,
  applyWorkflowColumnVisibility,
  groupPreviousStepSummary,
  groupYourStepSummary,
  groupReadinessPercent,
  groupHasCfoActions,
  groupHasCfoDecisionActions,
  groupHasCfoCompleteActions,
  groupHasWorkflowActions,
  groupHasWorkflowApprove,
  groupHasWorkflowRevision,
  groupHasWorkflowReturn,
  groupRegistryStatus,
  isGroupActionable,
  isGroupSelectable,
  isRowActionable,
  canQuickDecideGroup,
  parseMoneyInput,
  REGISTRY_COLUMNS,
  REGISTRY_VIEW_LABELS,
  resolvePointApprovalAmount,
  orderedRegistryColumns,
  rowRegistryStatus,
  STATUS_LABELS,
  toMoneyInput,
  usesWorkflowStepColumns,
  workflowApproveLabel,
  type RegistryColumnId,
  type RegistryFilters,
  type RegistryView,
} from './approval-register/registryConfig';
import {
  aggregateRegisterRows,
  buildRegisterControlRows,
  computeRegisterVisibility,
  filterRegisterGroups,
  getRegisterAutoFitValues,
  adjustRegisterStatusFilterValues,
  REGISTRY_COLUMN_MIN_WIDTHS,
  REGISTRY_TABLE_COLUMN_DEFINITIONS,
  sortRegisterGroups,
  sortRegisterItems,
} from './approval-register/registryTableColumns';
import { useTableColumnControls, type TableSortState, type TableFilterOption } from '../utils/tableColumns';
import { RegistryGroupStatusCell, RegistryStatusCell, type RegistryRowDecision } from './approval-register/RegistryStatusCell';
import { RegistryYourDecisionCell } from './approval-register/registryWorkflowCells';
import { STATUS_LEGEND_SPECS, StatusVisualBadge, rowStatusPresentation } from './approval-register/registryStatusVisual';
import { RequestHistoryDrawer, type RequestHistoryTarget } from './request-history/RequestHistoryDrawer';
import { RequestHistoryPanel } from './request-history/RequestHistoryPanel';
import { RegisterHistoryDrawer } from './request-history/RegisterHistoryDrawer';
import { ANALYTICS_FIELD_KEYS, ANALYTICS_FIELD_LABELS, EMPTY_ANALYTICS_FILTERS, buildRegisterFilterParams, canEditItemAnalytics, type AnalyticsFieldKey } from '../utils/analyticsFields';
import { EditableAnalyticsCell } from './EditableAnalyticsCell';
import { GroupAnalyticsCell } from './GroupAnalyticsCell';
import { ExportSettingsDialog } from './ExportSettingsDialog';
import type { ApprovalRegisterGroup, ApprovalRegisterResponse, ApprovalRegisterRow, ApprovalRegisterRowsResponse, ApprovalStep, BudgetItem, FileAttachment, ItemStatus, RegisterAggregates, RegisterAnalyticsSummary, RegisterGroupingLevel, RequestLog, Unit, User } from '../types';
import { money, requestStatusLabels } from '../utils/labels';
import { REGISTER_EXPORT_STATUSES, defaultExportSettings, exportSettingsFromRegister, type ExportSettingsState } from '../utils/exportSettings';
import { buildRegisterHref, registerDrillFromSearchParams } from '../utils/dashboardNavigation';
import { filterFieldSx } from '../utils/responsive';
import { canUseRegisterApprovalMode } from '../utils/roles';
import { resolveApprovalRoutePanel, type ApprovalRouteModule } from './approval-register/approvalRoutePanel';
import { stepReadinessLabels } from '../utils/workflowPresentation';
import { FilePreviewDialog } from './FilePreviewDialog';

const LEGACY_PREFERENCES_KEY = 'budgetbasket:approval-register:preferences';
const LEGACY_COLUMNS_KEY = 'budgetbasket:approval-register:columns';
const REQUEST_PAGE_SIZE_KEY = 'budgetbasket:register:request-page-size';
const FilteredRegisterItemsContext = createContext<Map<string, ApprovalRegisterRow[]> | null>(null);
const PointRevisionContext = createContext<(item: ApprovalRegisterRow) => void>(() => undefined);
const RegisterViewContext = createContext<RegistryView>('cfo');
const REGISTER_MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function preferencesStorageKey(userId: string) {
  return `budgetbasket:approval-register:preferences:${userId || 'anonymous'}`;
}

function registerViewStorageKey(userId: string) {
  return `budgetbasket:register:view:${userId || 'anonymous'}`;
}

function defaultRegisterView(user: User): RegistryView {
  if (user.role === 'employee') return 'cfo';
  if (['economist', 'approver', 'zgd'].includes(user.role)) return 'cfo';
  return 'module';
}

const GROUPING_PRESETS: Record<RegistryView, RegisterGroupingLevel[]> = {
  cfo: ['cfo', 'article', 'category', 'module'],
  category: ['category', 'module'],
  article: ['article', 'category', 'module'],
  module: ['module', 'article', 'category'],
  request: ['request'],
};
const GROUPING_LEVELS: RegisterGroupingLevel[] = [
  'cfo', 'article', 'category', 'module', 'request', ...ANALYTICS_FIELD_KEYS,
];
const GROUPING_LEVEL_LABELS: Record<RegisterGroupingLevel, string> = {
  cfo: 'ЦФО', article: 'Статья', category: 'Категория', module: 'Модуль', request: 'Заявка',
  ...ANALYTICS_FIELD_LABELS,
};

function normalizedGrouping(value: unknown): RegisterGroupingLevel[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const levels = value.filter((level): level is RegisterGroupingLevel => (
    typeof level === 'string' && GROUPING_LEVELS.includes(level as RegisterGroupingLevel)
  ));
  return levels.length === value.length && levels.length === new Set(levels).size ? levels : undefined;
}
const DRILL_FILTER_KEYS = ['cfoId', 'articleId', 'requestStatus', 'flow', 'frozen'] as const;

function filtersForPersistence(filters: RegistryFilters): RegistryFilters {
  const persisted = { ...filters };
  DRILL_FILTER_KEYS.forEach((key) => { persisted[key] = ''; });
  persisted.positionedOnly = false;
  return persisted;
}

const EMPTY_FILTERS: RegistryFilters = { search: '', flow: '', status: '', budgetYear: '', cfoId: '', articleId: '', requestStatus: '', frozen: '', positionedOnly: false, ...EMPTY_ANALYTICS_FILTERS };

type RowDecision = 'approved' | 'approved_with_changes' | 'rejected' | 'on_revision';
type DecisionTarget = {
  rows: ApprovalRegisterRow[];
  decision: RowDecision;
  amount?: number;
  allowAmountEdit?: boolean;
  allowDecisionChoice?: boolean;
  /** A row-level draft entered in the register before opening the decision dialog. */
  comment?: string;
};

function groupEntityId(group: ApprovalRegisterGroup) {
  const segment = group.id.split('/').at(-1) || '';
  const prefix = `${group.type}:`;
  return segment.startsWith(prefix) ? segment.slice(prefix.length) : '';
}

function cfoIdFromGroupId(groupId: string) {
  const segment = groupId.split('/').find((part) => part.startsWith('cfo:'));
  return segment?.slice(4);
}

function articleRegisterDetailHref(user: User, group: ApprovalRegisterGroup) {
  const cfoId = cfoIdFromGroupId(group.id);
  const view: RegistryView = user.role === 'economist' || user.role === 'approver' || user.role === 'zgd' ? 'cfo' : 'article';
  return buildRegisterHref(user, {
    view,
    articleId: group.article_id,
    ...(cfoId ? { cfoId } : {}),
  });
}

function groupStructureCaptionExtras(group: ApprovalRegisterGroup, user: User) {
  if (group.type === 'article' && group.article_id) {
    return (
      <>
        {' · '}
        <Box
          component="a"
          href={articleRegisterDetailHref(user, group)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          sx={{ color: 'primary.main', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
        >
          детализация по статье
        </Box>
      </>
    );
  }
  if (group.type === 'module' && group.request_ids.length === 1) {
    return (
      <>
        {' · '}
        <Box
          component="a"
          href={`/requests/${group.request_ids[0]}?article_id=${encodeURIComponent(group.article_id)}&category_id=${encodeURIComponent(group.category_id)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          sx={{ color: 'primary.main', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
        >
          заявка №{group.request_ids[0].slice(0, 8)}
        </Box>
      </>
    );
  }
  return null;
}

function revisionTargetFromGroup(group: ApprovalRegisterGroup) {
  return {
    groupType: group.type as 'cfo' | 'article' | 'category' | 'module' | 'request',
    groupId: groupEntityId(group),
    groupName: group.name,
  };
}

const RegisterQueryContext = createContext<Record<string, unknown>>({});
const EMPTY_REGISTER_CONTROLS: ReturnType<typeof buildRegisterControlRows> = [];

function collectDescendantGroups(group: ApprovalRegisterGroup): ApprovalRegisterGroup[] {
  return [group, ...group.children.flatMap(collectDescendantGroups)];
}

function collectExpandableGroupIds(group: ApprovalRegisterGroup): string[] {
  const ids: string[] = [];
  const visit = (node: ApprovalRegisterGroup) => {
    if (node.has_children || node.children.length || node.can_load_rows) ids.push(node.id);
    node.children.forEach(visit);
  };
  visit(group);
  return ids;
}

function collectDefaultExpandedGroupIds(groups: ApprovalRegisterGroup[], view: RegistryView): string[] {
  const expandTypes = new Set<string>(
    view === 'cfo' ? ['cfo', 'article']
      : view === 'module' ? ['module', 'article']
        : view === 'article' ? ['article']
          : view === 'category' ? ['category', 'module']
            : [],
  );
  const ids: string[] = [];
  const visit = (nodes: ApprovalRegisterGroup[]) => {
    nodes.forEach((group) => {
      if (expandTypes.has(group.type) && (group.has_children || group.children.length || group.can_load_rows)) {
        ids.push(group.id);
      }
      visit(group.children);
    });
  };
  visit(groups);
  return ids;
}

function buildParentMap(groups: ApprovalRegisterGroup[]): Map<string, string> {
  const parents = new Map<string, string>();
  const walk = (nodes: ApprovalRegisterGroup[], parentId?: string) => {
    nodes.forEach((node) => {
      if (parentId) parents.set(node.id, parentId);
      walk(node.children, node.id);
    });
  };
  walk(groups);
  return parents;
}

function topLevelSelectedGroups(groups: ApprovalRegisterGroup[], parents: Map<string, string>) {
  const ids = new Set(groups.map((group) => group.id));
  return groups.filter((group) => {
    let parentId = parents.get(group.id);
    while (parentId) {
      if (ids.has(parentId)) return false;
      parentId = parents.get(parentId);
    }
    return true;
  });
}

function readPreferences(
  userId: string,
  role?: User['role'],
): { view?: RegistryView; groupBy?: RegisterGroupingLevel[]; filters?: RegistryFilters; order: RegistryColumnId[]; visibility: Record<RegistryColumnId, boolean>; widths: Record<RegistryColumnId, number> } {
  const roleVisibility = defaultRegistryColumnVisibility(role);
  try {
    const userKey = preferencesStorageKey(userId);
    const raw = localStorage.getItem(userKey) ?? localStorage.getItem(LEGACY_PREFERENCES_KEY);
    const legacyRaw = localStorage.getItem(LEGACY_COLUMNS_KEY);
    if (!raw && !legacyRaw) return { order: DEFAULT_COLUMN_ORDER, visibility: roleVisibility, widths: DEFAULT_COLUMN_WIDTHS };
    const parsed: unknown = JSON.parse(raw || legacyRaw || '');
    if (!parsed || typeof parsed !== 'object') return { order: DEFAULT_COLUMN_ORDER, visibility: roleVisibility, widths: DEFAULT_COLUMN_WIDTHS };
    const value = parsed as { view?: RegistryView; groupBy?: unknown; filters?: Partial<RegistryFilters>; order?: RegistryColumnId[]; visibility?: Partial<Record<RegistryColumnId, boolean>>; widths?: Partial<Record<RegistryColumnId, number>> };
    const migratedFromLegacy = !localStorage.getItem(userKey) && Boolean(raw);
    const view = value.view;
    const mergedVisibility = { ...roleVisibility, ...value.visibility };
    // Restore line-detail columns after the dense layout that hid them.
    if (
      usesWorkflowStepColumns(role)
      && value.visibility
      && value.visibility.justification === false
      && value.visibility.files === false
    ) {
      mergedVisibility.justification = true;
      mergedVisibility.comment = true;
      mergedVisibility.files = true;
    }
    return {
      view,
      groupBy: normalizedGrouping(value.groupBy),
      filters: value.filters ? { ...EMPTY_FILTERS, ...value.filters, cfoId: '', articleId: '', requestStatus: '' } : undefined,
      order: value.order?.filter((id): id is RegistryColumnId => DEFAULT_COLUMN_ORDER.includes(id)) || DEFAULT_COLUMN_ORDER,
      visibility: applyWorkflowColumnVisibility(mergedVisibility, role),
      widths: { ...DEFAULT_COLUMN_WIDTHS, ...value.widths },
    };
  } catch {
    return { order: DEFAULT_COLUMN_ORDER, visibility: roleVisibility, widths: DEFAULT_COLUMN_WIDTHS };
  }
}

const REGISTRY_FILTER_SX = {
  '& .MuiInputBase-root': { height: 34, fontSize: 13 },
  '& .MuiInputLabel-root': { fontSize: 13, transform: 'translate(14px, 8px) scale(1)' },
  '& .MuiInputLabel-shrink': { transform: 'translate(14px, -7px) scale(0.78)' },
  '& .MuiSelect-select, & .MuiInputBase-input': { py: '6px !important' },
};

function RegistryStatusLegend({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={compact ? 0.75 : 1} flexWrap="wrap" useFlexGap alignItems="center">
      {STATUS_LEGEND_SPECS.map((spec) => (
        <Box key={spec.text} sx={{ width: compact ? 118 : 132, flex: '0 0 auto' }}>
          <StatusVisualBadge spec={spec} />
        </Box>
      ))}
    </Stack>
  );
}

function registerRowScopeParams(group: ApprovalRegisterGroup, paging: { page: number; page_size: number; request_id?: string }) {
  const scope: Record<string, string | number | undefined> = {
    ...Object.fromEntries(Object.entries(group.scope || {}).map(([key, value]) => [
      key,
      key.startsWith('analytics_') && value === '' ? '__empty__' : value,
    ])),
    ...paging,
  };
  if (group.scope) return scope;
  if (group.type === 'cfo') {
    const cfoId = groupEntityId(group);
    if (cfoId) scope.cfo_id = cfoId;
  }
  if (group.article_id) scope.article_id = group.article_id;
  if (group.type === 'category') scope.category_id = group.category_id;
  if (group.type === 'module') {
    scope.category_id = group.category_id;
    scope.module_id = group.module_id;
  }
  return scope;
}

function isAnalyticsGroup(group: ApprovalRegisterGroup): group is ApprovalRegisterGroup & { type: AnalyticsFieldKey } {
  return ANALYTICS_FIELD_KEYS.includes(group.type as AnalyticsFieldKey);
}

function groupMatchesRow(group: ApprovalRegisterGroup, item: ApprovalRegisterRow) {
  if (group.scope) {
    return Object.entries(group.scope).every(([key, value]) => String(item[key as keyof ApprovalRegisterRow] || '') === value);
  }
  if (isAnalyticsGroup(group)) return (item[group.type] || '') === (group.group_value || '');
  if (group.type === 'cfo') return groupEntityId(group) === item.cfo_id;
  if (group.type === 'article') return item.article_id === group.article_id;
  if (group.type === 'category') return item.category_id === group.category_id;
  if (group.type === 'module') return item.module_id === group.module_id;
  return group.type !== 'request' || groupEntityId(group) === item.request_id;
}

async function postRowDecision(row: ApprovalRegisterRow, decision: RowDecision, comment: string, amount?: number) {
  let resolvedDecision = decision;
  if (amount !== undefined && decision === 'approved' && amount !== row.requested_sum) {
    resolvedDecision = 'approved_with_changes';
  }
  const payload = { decision: resolvedDecision, comment, ...(amount === undefined ? {} : { sum_fact: amount }) };
  if (row.is_cfo_review_actionable || row.decision_editable_stage === 'cfo_review') {
    return api.post<BudgetItem>(`/items/${row.id}/cfo-decision`, payload);
  }
  if ((row.is_final_approval_actionable || row.decision_editable_stage === 'approver') && row.position_id && row.current_step_id) {
    if (resolvedDecision !== 'approved') {
      throw new Error('Для возврата строки на доработку используйте кнопку со стрелкой.');
    }
    return api.post(`/steps/${row.current_step_id}/positions/${row.position_id}/approve`, {
      comment,
      item_ids: [row.id],
    });
  }
  if ((row.is_approval_actionable || row.decision_editable_stage === 'economist') && row.position_id) {
    return api.post<BudgetItem>(`/cfo-positions/${row.position_id}/items/${row.id}/decision`, payload);
  }
  throw new Error('Для этой строки действие больше недоступно. Обновите реестр.');
}

async function postBulkRowDecision(rows: ApprovalRegisterRow[], decision: RowDecision, comment: string) {
  const cfoRows = rows.filter((row) => row.is_cfo_review_actionable || row.decision_editable_stage === 'cfo_review');
  const finalApprovalRows = rows.filter((row) => (row.is_final_approval_actionable || row.decision_editable_stage === 'approver') && row.position_id && row.current_step_id);
  if (finalApprovalRows.length && decision !== 'approved') {
    throw new Error('Для возврата строк на доработку используйте кнопку «На доработку».');
  }
  // Every request below is one UI bulk operation, even when the selected
  // lines belong to different CFO positions. Reuse one audit event id so the
  // history drawer can render it as one grouped action.
  const approvalEventId = finalApprovalRows.length ? crypto.randomUUID() : undefined;
  const workflowRowsByPosition = new Map<string, ApprovalRegisterRow[]>();
  rows.forEach((row) => {
    if (
      row.is_cfo_review_actionable
      || row.decision_editable_stage === 'cfo_review'
      || row.is_final_approval_actionable
      || row.decision_editable_stage === 'approver'
      || (!row.is_approval_actionable && row.decision_editable_stage !== 'economist')
      || !row.position_id
    ) return;
    const positionRows = workflowRowsByPosition.get(row.position_id) || [];
    positionRows.push(row);
    workflowRowsByPosition.set(row.position_id, positionRows);
  });
  const requests: Promise<unknown>[] = [];
  if (cfoRows.length) {
    requests.push(api.post('/items/cfo-decision/bulk', {
      item_ids: cfoRows.map((row) => row.id),
      decision,
      comment,
    }));
  }
  if (finalApprovalRows.length) {
    const positionRows = new Map<string, { step_id: string; position_id: string; item_ids: string[] }>();
    finalApprovalRows.forEach((row) => {
      const key = `${row.current_step_id}:${row.position_id}`;
      const selection = positionRows.get(key) || {
        step_id: row.current_step_id!,
        position_id: row.position_id!,
        item_ids: [],
      };
      selection.item_ids.push(row.id);
      positionRows.set(key, selection);
    });
    requests.push(api.post('/approval-position-lines/approve/bulk', {
      positions: [...positionRows.values()],
      comment,
      ...(approvalEventId ? { event_id: approvalEventId } : {}),
    }));
  }
  workflowRowsByPosition.forEach((positionRows, positionId) => {
    requests.push(api.post(`/cfo-positions/${positionId}/items/decision/bulk`, {
      item_ids: positionRows.map((row) => row.id),
      decision,
      comment,
    }));
  });
  if (!requests.length) throw new Error('Выбранные строки больше недоступны для согласования. Обновите реестр.');
  return Promise.all(requests);
}

function aggregateStatus(aggregates: RegisterAggregates) {
  if (!aggregates.total_rows) return 'no_data' as const;
  if (aggregates.approved_rows === aggregates.total_rows) return 'approved' as const;
  if (aggregates.rejected_rows === aggregates.total_rows) return 'rejected' as const;
  if (!aggregates.pending_rows) return 'partially_approved' as const;
  if (!aggregates.approved_rows && !aggregates.rejected_rows) return 'on_review' as const;
  return 'in_progress' as const;
}

function applyItemChange(aggregates: RegisterAggregates, previous: ApprovalRegisterRow, next: Pick<BudgetItem, 'status' | 'sum_fact'>): RegisterAggregates {
  const wasApproved = previous.status === 'approved' || previous.status === 'approved_with_changes';
  const wasRejected = previous.status === 'rejected';
  const approved = next.status === 'approved' || next.status === 'approved_with_changes';
  const rejected = next.status === 'rejected';
  const approvedRows = aggregates.approved_rows + Number(approved) - Number(wasApproved);
  const rejectedRows = aggregates.rejected_rows + Number(rejected) - Number(wasRejected);
  const approvedSum = aggregates.approved_sum - previous.approved_sum + (approved ? Number(next.sum_fact || 0) : 0);
  const updated = {
    ...aggregates,
    approved_rows: approvedRows,
    rejected_rows: rejectedRows,
    pending_rows: aggregates.total_rows - approvedRows - rejectedRows,
    approved_sum: approvedSum,
    rejected_sum: aggregates.rejected_sum - (wasRejected ? previous.requested_sum : 0) + (rejected ? previous.requested_sum : 0),
    pending_sum: aggregates.pending_sum - (!wasApproved && !wasRejected ? previous.requested_sum : 0) + (!approved && !rejected ? previous.requested_sum : 0),
    difference: approvedSum - aggregates.requested_sum,
  };
  return { ...updated, aggregate_status: aggregateStatus(updated) };
}

function updateRegisterCache(queryClient: ReturnType<typeof useQueryClient>, previous: ApprovalRegisterRow, next: Pick<BudgetItem, 'status' | 'sum_fact'>) {
  queryClient.setQueriesData<ApprovalRegisterRowsResponse>({ queryKey: ['approval-register-rows'] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      items: current.items.map((item) => item.id === previous.id
        ? { ...item, status: next.status, approved_sum: next.status === 'approved' || next.status === 'approved_with_changes' ? Number(next.sum_fact || 0) : 0 }
        : item),
      group: { ...current.group, aggregates: applyItemChange(current.group.aggregates, previous, next) },
    };
  });
  queryClient.setQueriesData<ApprovalRegisterResponse>({ queryKey: ['approval-register'] }, (current) => {
    if (!current?.groups || !current?.aggregates) return current;
    const updateGroups = (groups: ApprovalRegisterGroup[]): ApprovalRegisterGroup[] => groups.map((group) => {
      const includesItem = group.module_id === previous.module_id && group.request_ids.includes(previous.request_id);
      return {
        ...group,
        aggregates: includesItem ? applyItemChange(group.aggregates, previous, next) : group.aggregates,
        children: updateGroups(group.children),
      };
    });
    return { ...current, aggregates: applyItemChange(current.aggregates, previous, next), groups: updateGroups(current.groups) };
  });
}

function RegistryFilterBar({
  view,
  filters,
  onViewChange,
  onChange,
  onReset,
  onSave,
  availableViews,
  groupBy,
  onGroupByChange,
  analyticsFilterOptions = {},
  drillLabels,
  hideFlowSelect = false,
}: {
  view: RegistryView;
  filters: RegistryFilters;
  onViewChange: (view: RegistryView) => void;
  onChange: (next: RegistryFilters) => void;
  onReset: () => void;
  onSave: () => void;
  availableViews: RegistryView[];
  groupBy: RegisterGroupingLevel[];
  onGroupByChange: (levels: RegisterGroupingLevel[]) => void;
  analyticsFilterOptions?: Partial<Record<AnalyticsFieldKey, string[]>>;
  drillLabels?: { cfoName?: string; articleName?: string };
  hideFlowSelect?: boolean;
}) {
  const [moreFiltersAnchor, setMoreFiltersAnchor] = useState<HTMLElement | null>(null);
  const [groupingAnchor, setGroupingAnchor] = useState<HTMLElement | null>(null);
  const analyticsKeys = ANALYTICS_FIELD_KEYS.filter((key) => (analyticsFilterOptions[key] || []).length > 0);
  const primaryAnalyticsKey = analyticsKeys[0];
  const additionalAnalyticsKeys = analyticsKeys.slice(1);
  const additionalFiltersCount = additionalAnalyticsKeys.filter((key) => filters[key]).length;
  const hasActiveFilters = Boolean(
    filters.search
    || filters.flow
    || filters.status
    || filters.budgetYear
    || filters.cfoId
    || filters.articleId
    || filters.requestStatus
    || filters.frozen
    || filters.positionedOnly
    || ANALYTICS_FIELD_KEYS.some((key) => filters[key]),
  );
  const moveGroupingLevel = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= groupBy.length) return;
    const next = [...groupBy];
    [next[index], next[target]] = [next[target], next[index]];
    onGroupByChange(next);
  };
  return (
    <Paper variant="outlined" className="approval-register-filters" sx={{ px: 1, py: 0.75, borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5, bgcolor: '#F8FAFC' }}>
      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={0.75} alignItems={{ xl: 'center' }} justifyContent="space-between">
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.75} useFlexGap sx={{ flex: 1, minWidth: 0, ...REGISTRY_FILTER_SX }}>
          <TextField select size="small" value={view} onChange={(event) => onViewChange(event.target.value as RegistryView)} inputProps={{ 'aria-label': 'Группировка реестра' }} sx={{ ...filterFieldSx(128), maxWidth: { lg: 128 } }}>
            {availableViews.map((key) => <MenuItem key={key} value={key} dense>{key === 'cfo' ? 'По ЦФО' : REGISTRY_VIEW_LABELS[key]}</MenuItem>)}
          </TextField>
          <Button size="small" variant="outlined" color="inherit" onClick={(event) => setGroupingAnchor(event.currentTarget)} sx={{ height: 34, whiteSpace: 'nowrap' }}>
            Уровни · {groupBy.length}
          </Button>
          <TextField
            size="small"
            placeholder="Поиск по строке, статье, модулю или заявке"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            sx={{ minWidth: { md: 220 }, flex: { lg: '1 1 260px' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} color="action" /></InputAdornment> }}
          />
          {!hideFlowSelect && (
            <TextField select size="small" label="Вид бюджета" value={filters.flow} onChange={(event) => onChange({ ...filters, flow: event.target.value as RegistryFilters['flow'] })} sx={{ ...filterFieldSx(145), maxWidth: { lg: 145 } }}>
              <MenuItem value="" dense>Все</MenuItem>
              <MenuItem value="expense" dense>Расходы</MenuItem>
              <MenuItem value="income" dense>Доходы</MenuItem>
            </TextField>
          )}
          <TextField select size="small" label="Статус" value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value as RegistryFilters['status'] })} sx={{ ...filterFieldSx(150), maxWidth: { lg: 150 } }}>
            <MenuItem value="" dense>Все</MenuItem>
            {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((status) => <MenuItem key={status} value={status} dense>{STATUS_LABELS[status]}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Бюджетный год" type="number" placeholder="2025" value={filters.budgetYear} onChange={(event) => onChange({ ...filters, budgetYear: event.target.value })} sx={{ ...filterFieldSx(118), maxWidth: { lg: 118 } }} />
          {primaryAnalyticsKey && (
            <TextField
              select
              size="small"
              label={ANALYTICS_FIELD_LABELS[primaryAnalyticsKey]}
              value={filters[primaryAnalyticsKey]}
              onChange={(event) => onChange({ ...filters, [primaryAnalyticsKey]: event.target.value })}
              sx={{ ...filterFieldSx(150), maxWidth: { lg: 170 } }}
            >
              <MenuItem value="" dense>Все</MenuItem>
              {(analyticsFilterOptions[primaryAnalyticsKey] || []).map((value) => <MenuItem key={value} value={value} dense>{value}</MenuItem>)}
            </TextField>
          )}
          {additionalAnalyticsKeys.length > 0 && <Button size="small" variant="outlined" color="inherit" startIcon={<FilterAltOutlinedIcon sx={{ fontSize: 17 }} />} onClick={(event) => setMoreFiltersAnchor(event.currentTarget)} sx={{ height: 34, whiteSpace: 'nowrap' }}>Фильтры{additionalFiltersCount ? ` · ${additionalFiltersCount}` : ''}</Button>}
        </Stack>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', xl: 'flex-end' }} alignItems="center" sx={{ '& .MuiButton-root': { height: 34, minHeight: 34, fontSize: 13, px: 1.25 } }}>
          <Button size="small" variant="text" color="inherit" startIcon={<RestartAltIcon sx={{ fontSize: 18 }} />} disabled={!hasActiveFilters} onClick={onReset}>Сбросить</Button>
          <Button size="small" variant="text" color="inherit" startIcon={<BookmarkAddOutlinedIcon sx={{ fontSize: 18 }} />} onClick={onSave}>Сохранить фильтр</Button>
        </Stack>
      </Stack>
      <Menu anchorEl={moreFiltersAnchor} open={!!moreFiltersAnchor} onClose={() => setMoreFiltersAnchor(null)} PaperProps={{ sx: { p: 1, minWidth: 260 } }}>
        {additionalAnalyticsKeys.map((key) => (
          <Box key={key} sx={{ px: 0.5, py: 0.4 }}>
            <TextField select fullWidth size="small" label={ANALYTICS_FIELD_LABELS[key]} value={filters[key]} onChange={(event) => onChange({ ...filters, [key]: event.target.value })}>
              <MenuItem value="" dense>Все</MenuItem>
              {(analyticsFilterOptions[key] || []).map((value) => <MenuItem key={value} value={value} dense>{value}</MenuItem>)}
            </TextField>
          </Box>
        ))}
      </Menu>
      <Menu anchorEl={groupingAnchor} open={!!groupingAnchor} onClose={() => setGroupingAnchor(null)} PaperProps={{ sx: { p: 1, minWidth: 285 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pb: 0.75 }}>Порядок группировки</Typography>
        {groupBy.map((level, index) => (
          <Stack key={level} direction="row" alignItems="center" spacing={0.25} sx={{ px: 0.5, py: 0.2 }}>
            <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>{index + 1}. {GROUPING_LEVEL_LABELS[level]}</Typography>
            <Button size="small" disabled={index === 0} onClick={() => moveGroupingLevel(index, -1)} sx={{ minWidth: 28, px: 0.25 }}>↑</Button>
            <Button size="small" disabled={index === groupBy.length - 1} onClick={() => moveGroupingLevel(index, 1)} sx={{ minWidth: 28, px: 0.25 }}>↓</Button>
            <Button size="small" color="inherit" disabled={groupBy.length === 1} onClick={() => onGroupByChange(groupBy.filter((item) => item !== level))} sx={{ minWidth: 28, px: 0.25 }}>×</Button>
          </Stack>
        ))}
        <Divider sx={{ my: 0.75 }} />
        {GROUPING_LEVELS.filter((level) => !groupBy.includes(level)).map((level) => (
          <MenuItem key={level} dense onClick={() => onGroupByChange([...groupBy, level])}>+ {GROUPING_LEVEL_LABELS[level]}</MenuItem>
        ))}
      </Menu>
      {hasActiveFilters ? (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ pt: 0.75 }}>
          {filters.search ? <Chip label={`Поиск: ${filters.search}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {filters.flow ? <Chip label={`Вид бюджета: ${filters.flow === 'income' ? 'Доходы' : 'Расходы'}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {filters.requestStatus ? (
            <Chip
              label={`Заявка: ${requestStatusLabels[filters.requestStatus as keyof typeof requestStatusLabels] || filters.requestStatus}`}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11 }}
            />
          ) : null}
          {filters.frozen ? <Chip label={filters.frozen === 'fixed' ? 'Фиксация: ЗГД' : 'Фиксация: есть'} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {filters.positionedOnly ? <Chip label="Отчёт дашборда" size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {filters.cfoId ? (
            <Chip
              label={drillLabels?.cfoName ? `ЦФО: ${drillLabels.cfoName}` : 'Фильтр по ЦФО'}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11 }}
            />
          ) : null}
          {filters.articleId ? (
            <Chip
              label={drillLabels?.articleName ? `Статья: ${drillLabels.articleName}` : 'Фильтр по статье'}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11 }}
            />
          ) : null}
          {filters.status ? <Chip label={`Статус: ${STATUS_LABELS[filters.status]}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {filters.budgetYear ? <Chip label={`Год: ${filters.budgetYear}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} /> : null}
          {ANALYTICS_FIELD_KEYS.filter((key) => filters[key]).map((key) => (
            <Chip key={key} label={`${ANALYTICS_FIELD_LABELS[key]}: ${filters[key]}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
          ))}
        </Stack>
      ) : null}
    </Paper>
  );
}

function resolveRegisterDrillLabels(
  groups: ApprovalRegisterGroup[],
  filters: Pick<RegistryFilters, 'cfoId' | 'articleId'>,
) {
  let cfoName: string | undefined;
  let articleName: string | undefined;
  const visit = (nodes: ApprovalRegisterGroup[]) => {
    nodes.forEach((group) => {
      if (filters.cfoId && group.type === 'cfo' && groupEntityId(group) === filters.cfoId) {
        cfoName = group.name;
      }
      if (filters.articleId && group.type === 'article' && group.article_id === filters.articleId) {
        articleName = group.name;
      }
      if (filters.articleId && group.type === 'category' && group.category_id === filters.articleId) {
        articleName = articleName || group.name;
      }
      visit(group.children);
    });
  };
  visit(groups);
  return { cfoName, articleName };
}

function registerDrillTitle(
  filters: Pick<RegistryFilters, 'cfoId' | 'articleId' | 'requestStatus'>,
  labels: { cfoName?: string; articleName?: string },
) {
  if (!filters.articleId && !filters.cfoId && !filters.requestStatus) return null;
  const articleLabel = labels.articleName || 'выбранной статье';
  const cfoLabel = labels.cfoName || 'выбранному ЦФО';
  if (filters.articleId && filters.cfoId) {
    return `Детализация по статье «${articleLabel}» в ЦФО «${cfoLabel}»`;
  }
  if (filters.articleId) {
    return `Детализация по статье «${articleLabel}»`;
  }
  if (filters.cfoId) {
    return `Детализация по ЦФО «${cfoLabel}»`;
  }
  if (filters.requestStatus) {
    const statusLabel = requestStatusLabels[filters.requestStatus as keyof typeof requestStatusLabels] || filters.requestStatus;
    return `Заявки со статусом «${statusLabel}»`;
  }
  return null;
}

function RegistrySummary({ aggregates }: { aggregates: RegisterAggregates }) {
  const readiness = groupReadinessPercent(aggregates);
  const metrics = [
    { label: 'Всего строк', value: String(aggregates.total_rows), tone: 'default' as const },
    { label: 'Запрошено', value: money(aggregates.requested_sum), tone: 'default' as const },
    { label: 'Согласовано', value: money(aggregates.approved_sum), tone: 'success' as const },
    { label: 'Корректировка', value: money(aggregates.difference), tone: 'warning' as const },
    { label: 'На рассмотрении', value: money(aggregates.pending_sum), tone: 'warning' as const },
  ];
  return (
    <Paper variant="outlined" className="approval-register-summary" sx={{ borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5, overflow: 'hidden', bgcolor: '#fff' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems="stretch">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' }, flex: 1 }}>
          {metrics.map((metric) => (
            <Box key={metric.label} sx={{ px: 1.5, py: 0.85, borderRight: { md: '1px solid rgba(15, 23, 42, 0.06)' }, borderBottom: { xs: '1px solid rgba(15, 23, 42, 0.06)', md: 0 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.2 }}>{metric.label}</Typography>
              <Tooltip title={metric.value}>
                <Typography variant="body2" fontWeight={700} noWrap sx={{ mt: 0.15, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: metric.tone === 'success' ? 'success.main' : metric.tone === 'warning' ? 'warning.dark' : 'text.primary' }}>
                  {metric.value}
                </Typography>
              </Tooltip>
            </Box>
          ))}
        </Box>
        <Stack spacing={0.45} justifyContent="center" sx={{ px: 1.75, py: 0.85, minWidth: { md: 160 }, borderTop: { xs: '1px solid rgba(15, 23, 42, 0.06)', md: 0 }, borderLeft: { md: '1px solid rgba(15, 23, 42, 0.06)' } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>% согласования</Typography>
            <Typography variant="body2" fontWeight={700} sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{readiness}%</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={readiness} sx={{ height: 4, borderRadius: 99, bgcolor: '#E2E8F0', '& .MuiLinearProgress-bar': { borderRadius: 99, bgcolor: '#2563EB' } }} />
        </Stack>
      </Stack>
    </Paper>
  );
}

function buildRegisterAnalyticsSummary(rows: ApprovalRegisterRow[], baseAggregates: RegisterAggregates): RegisterAnalyticsSummary[] {
  return ANALYTICS_FIELD_KEYS.flatMap((field) => {
    const byValue = new Map<string, ApprovalRegisterRow[]>();
    rows.forEach((row) => {
      const value = String(row[field] || '').trim();
      if (!value) return;
      const bucket = byValue.get(value) || [];
      bucket.push(row);
      byValue.set(value, bucket);
    });
    if (!byValue.size) return [];
    const values = [...byValue.entries()].map(([value, valueRows]) => {
      const cfoLoads = new Map<string, { cfo_id: string; cfo_name: string; requested_sum: number; total_rows: number }>();
      valueRows.forEach((row) => {
        const cfoId = row.cfo_id || 'unassigned';
        const load = cfoLoads.get(cfoId) || {
          cfo_id: cfoId,
          cfo_name: row.cfo_name,
          requested_sum: 0,
          total_rows: 0,
        };
        load.requested_sum += Number(row.requested_sum || 0);
        load.total_rows += 1;
        cfoLoads.set(cfoId, load);
      });
      const topCfo = [...cfoLoads.values()].sort(
        (left, right) => right.requested_sum - left.requested_sum
          || right.total_rows - left.total_rows
          || left.cfo_name.localeCompare(right.cfo_name, 'ru'),
      )[0];
      return {
        value,
        aggregates: aggregateRegisterRows(baseAggregates, valueRows),
        top_cfo: topCfo,
      };
    }).sort(
      (left, right) => right.aggregates.requested_sum - left.aggregates.requested_sum
        || left.value.localeCompare(right.value, 'ru'),
    );
    return [{ field, label: ANALYTICS_FIELD_LABELS[field], values }];
  });
}

function AnalyticsSummaryList({ summary }: { summary: RegisterAnalyticsSummary[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!summary.length) return null;
  const toggle = (field: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    return next;
  });
  return (
    <Paper variant="outlined" sx={{ borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5, overflow: 'hidden', bgcolor: '#fff' }}>
      <Box sx={{ px: 1.5, py: 0.9, borderBottom: '1px solid rgba(15, 23, 42, 0.08)', bgcolor: '#F8FAFC' }}>
        <Typography variant="subtitle2" fontWeight={700}>Сводка по аналитикам</Typography>
      </Box>
      <Stack divider={<Divider flexItem />}>
        {summary.map((section) => {
          const isCollapsed = collapsed.has(section.field);
          return (
          <Box key={section.field} sx={{ overflowX: 'auto' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, pt: 0.45 }}>
              <Typography variant="body2" fontWeight={700} sx={{ px: 0.5, py: 0.55 }}>{section.label} · {section.values.length}</Typography>
              <IconButton size="small" onClick={() => toggle(section.field)} aria-label={isCollapsed ? `Развернуть ${section.label}` : `Свернуть ${section.label}`}>
                {isCollapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Stack>
            {!isCollapsed && <Table size="small" aria-label={`Сводка ${section.label}`} sx={{ minWidth: 650 }}>
              <TableHead>
                <TableRow sx={{ '& th': { py: 0.45, fontSize: 11, fontWeight: 700, color: 'text.secondary', bgcolor: '#FAFAFA' } }}>
                  <TableCell>Значение</TableCell>
                  <TableCell align="right">План, ₽</TableCell>
                  <TableCell align="right">Согласовано, ₽</TableCell>
                  <TableCell align="right">Строк</TableCell>
                  <TableCell>Наибольшая нагрузка ЦФО</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {section.values.map((item) => (
                  <TableRow key={item.value} hover sx={{ '& td': { py: 0.55, fontSize: 12 } }}>
                    <TableCell sx={{ fontWeight: 600 }}>{item.value}</TableCell>
                    <TableCell align="right">{money(item.aggregates.requested_sum)}</TableCell>
                    <TableCell align="right">{money(item.aggregates.approved_sum)}</TableCell>
                    <TableCell align="right">{item.aggregates.total_rows}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{item.top_cfo.cfo_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{money(item.top_cfo.requested_sum)} · {item.top_cfo.total_rows} стр.</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            }
          </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function RegistryFooter({ totalRows }: { totalRows: number }) {
  return (
    <Paper variant="outlined" className="approval-register-footer" sx={{ px: 1.25, py: 0.65, borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5, bgcolor: '#fff' }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.75} alignItems={{ lg: 'center' }} justifyContent="space-between">
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
          Всего строк: {totalRows}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="flex-end">
          <RegistryStatusLegend compact />
        </Stack>
      </Stack>
    </Paper>
  );
}

function DecisionDialog({ target, onClose, onSave, saving }: { target: DecisionTarget | null; onClose: () => void; onSave: (decision: RowDecision, comment: string, amount?: number) => void; saving: boolean }) {
  const [decision, setDecision] = useState<RowDecision>('approved');
  const [comment, setComment] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    setDecision(target?.decision || 'approved');
    setComment(target?.comment || '');
    const initialAmount = target?.amount ?? target?.rows[0]?.approved_sum ?? target?.rows[0]?.requested_sum;
    setAmount(initialAmount === undefined ? '' : toMoneyInput(initialAmount));
  }, [target]);
  if (!target) return null;
  const showAmount = decision === 'approved_with_changes' || (target.allowAmountEdit && decision === 'approved' && target.rows.length === 1);
  const adjustedAmount = showAmount ? parseMoneyInput(amount) : undefined;
  const resolvedDecision = decision === 'approved' && adjustedAmount !== undefined && adjustedAmount !== null
    && target.rows.length === 1 && adjustedAmount !== target.rows[0].requested_sum
    ? 'approved_with_changes'
    : decision;
  const requiresComment = resolvedDecision === 'rejected' || resolvedDecision === 'approved_with_changes' || resolvedDecision === 'on_revision';
  const title = resolvedDecision === 'on_revision'
    ? (target.rows.length === 1 ? 'Отметить строку на доработку' : 'Отметить строки на доработку')
    : resolvedDecision === 'rejected'
    ? (target.rows.length === 1 ? 'Отклонить строку' : 'Отклонить строки')
    : resolvedDecision === 'approved_with_changes'
      ? 'Согласовать строку'
      : target.allowAmountEdit
        ? 'Согласовать строку'
        : 'Согласовать строки';
  return <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs"><DialogTitle>{title}</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}>
    <Typography variant="body2" color="text.secondary">Будет обработано строк: {target.rows.length} · запрошено: {money(target.rows.reduce((total, row) => total + row.requested_sum, 0))}</Typography>
    {target.allowDecisionChoice && (
      <FormControl fullWidth size="small">
        <InputLabel id="approval-register-decision-label">Решение</InputLabel>
        <Select
          labelId="approval-register-decision-label"
          value={decision}
          label="Решение"
          onChange={(event) => setDecision(event.target.value as RowDecision)}
        >
          <MenuItem value="approved">Одобрить</MenuItem>
          <MenuItem value="approved_with_changes">Одобрить с изменениями</MenuItem>
          <MenuItem value="rejected">Отклонить</MenuItem>
        </Select>
      </FormControl>
    )}
    {resolvedDecision === 'on_revision' && (
      <Alert severity="warning" variant="outlined">Строка останется в текущей позиции до действия «На доработку». Укажите, что нужно исправить.</Alert>
    )}
    {resolvedDecision === 'rejected' && (
      <Alert severity="error" variant="outlined">Отклонение — финальное отрицательное решение по выбранным строкам. Для возврата с возможностью исправления используйте действие группы «На доработку».</Alert>
    )}
    {resolvedDecision === 'approved_with_changes' && (
      <Alert severity="info" variant="outlined">Факт отличается от плана, поэтому система оформит согласование с корректировкой автоматически. Укажите причину изменения.</Alert>
    )}
    {showAmount && (
      <TextField
        autoFocus
        size="small"
        label="Согласованная сумма"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        error={adjustedAmount === null || (adjustedAmount || 0) < 0}
        helperText="Можно согласовать сумму больше или меньше запрошенной"
      />
    )}
    <TextField size="small" label={requiresComment ? 'Комментарий' : 'Комментарий (необязательно)'} required={requiresComment} multiline minRows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
  </Stack></DialogContent><DialogActions><Button onClick={onClose} disabled={saving}>Отмена</Button><Button variant="contained" disabled={saving || (requiresComment && !comment.trim()) || (showAmount && (adjustedAmount === null || adjustedAmount === undefined || adjustedAmount < 0))} onClick={() => onSave(resolvedDecision, comment.trim(), adjustedAmount ?? undefined)}>{saving ? 'Сохраняется…' : 'Подтвердить'}</Button></DialogActions></Dialog>;
}

function RegistryDetailsDrawer({ item, onClose, onOpenHistory }: { item: ApprovalRegisterRow | null; onClose: () => void; onOpenHistory: (item: ApprovalRegisterRow, full?: boolean) => void }) {
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const { data: files = [] } = useQuery({ queryKey: ['registry-item-files', item?.id], queryFn: async () => (await api.get<FileAttachment[]>(`/items/${item!.id}/files`)).data, enabled: !!item });
  const { data: requestItems = [], isPending: itemsPending, isError: itemsError } = useQuery({
    queryKey: ['registry-request-items', item?.request_id],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${item!.request_id}/items`)).data,
    enabled: !!item,
  });
  const { data: logs = [], isPending: logsPending } = useQuery({
    queryKey: ['registry-request-logs', item?.request_id],
    queryFn: async () => (await api.get<RequestLog[]>(`/requests/${item!.request_id}/logs`)).data,
    enabled: !!item,
  });
  const planItem = item ? requestItems.find((requestItem) => requestItem.id === item.id) : undefined;
  const monthPlans = planItem?.month_plans || [];
  const field = (label: string, value: React.ReactNode, wide = false) => (
    <Box sx={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35, fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
    </Box>
  );
  return <Drawer anchor="right" open={!!item} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, bgcolor: '#F8FAFC' } }}>
    {item && <Stack spacing={0} sx={{ minHeight: '100%' }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2.25, pb: 1.75, bgcolor: '#fff', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.01em' }}>{item.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Заявка №{item.request_id.slice(0, 8)}</Typography>
          </Box>
          <IconButton aria-label="Закрыть" onClick={onClose} size="small" sx={{ mt: -0.5, mr: -0.75 }}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
      </Box>
      <Stack spacing={2.25} sx={{ px: { xs: 2, sm: 3 }, py: 2.25 }}>
      {item.status_context && (
        <Box sx={{ p: 1.5, borderRadius: 1, border: '1px solid', borderColor: item.status_context.editability.mode === 'editable' ? '#F6C36B' : '#D7DEE8', bgcolor: item.status_context.editability.mode === 'editable' ? '#FFF9ED' : '#fff' }}>
          <Typography variant="subtitle2" sx={{ mb: 0.65, fontWeight: 700 }}>
            {item.is_revision_actionable
              ? 'Требуется исправить строку'
              : item.status_context.editability.can_decide
                ? 'Требуется ваше решение'
                : item.status_context.editability.mode === 'editable'
                  ? 'Можно изменить данные'
                  : item.status_context.editability.mode === 'locked'
                    ? 'Изменения заблокированы'
                    : 'От вас действий не требуется'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>{item.status_context.editability.detail}</Typography>
          {item.approval_stage && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>Текущий этап: {item.approval_stage}</Typography>
          )}
          {item.status_context.last_decision?.by_name && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Последнее решение: {item.status_context.last_decision.action_label} · {item.status_context.last_decision.by_name}
              {item.status_context.last_decision.stage ? ` · ${item.status_context.last_decision.stage}` : ''}
            </Typography>
          )}
          {item.status_context.current_owner?.by_name && item.status_context.editability.mode !== 'editable' && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Сейчас ждёт {item.status_context.current_owner.role_label}: {item.status_context.current_owner.by_name}
            </Typography>
          )}
        </Box>
      )}
      {(item.status_context?.previous_step || item.status_context?.your_step) && <Box>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.08em' }}>Маршрут согласования</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, mt: 0.75 }}>
          {item.status_context?.previous_step && <Box sx={{ p: 1.25, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Предыдущий шаг</Typography>
            <Typography variant="body2" fontWeight={700}>{item.status_context.previous_step.amount != null ? `${money(item.status_context.previous_step.amount)} · ` : ''}{item.status_context.previous_step.label}</Typography>
            {item.status_context.previous_step.hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{item.status_context.previous_step.hint}</Typography>}
          </Box>}
          {item.status_context?.your_step && <Box sx={{ p: 1.25, bgcolor: '#fff', border: '1px solid', borderColor: '#BFD4FF', borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Ваше решение</Typography>
            <Typography variant="body2" fontWeight={700}>{item.status_context.your_step.amount != null ? `${money(item.status_context.your_step.amount)} · ` : ''}{item.status_context.your_step.label}</Typography>
            {item.status_context.your_step.hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{item.status_context.your_step.hint}</Typography>}
          </Box>}
        </Box>
      </Box>}
      <Box>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: '0.08em' }}>Детали строки</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.75, mt: 1 }}>
          {field('ЦФО', item.cfo_name)}{field('Статья', item.article_name)}{field('Категория', item.category_name)}{field('Модуль', item.module_name)}
          <Box sx={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1, p: 1.25, borderRadius: 1.5, bgcolor: '#fff', border: '1px solid', borderColor: 'divider' }}>
            {field('План', money(item.requested_sum))}{field('Факт', money(item.approved_sum))}
            {field('Корректировка', money(item.status === 'rejected' ? item.requested_sum : item.status === 'approved_with_changes' ? Math.max(item.requested_sum - item.approved_sum, 0) : 0))}
          </Box>
          <Box sx={{ gridColumn: '1 / -1', p: 1.5, borderRadius: 1.5, bgcolor: '#fff', border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>План по месяцам</Typography>
              {planItem && <Typography variant="caption" color="text.secondary">Итого: {money(planItem.sum_plan)}</Typography>}
            </Stack>
            {itemsPending ? <LinearProgress /> : itemsError ? (
              <Typography variant="body2" color="text.secondary">Не удалось загрузить помесячный план.</Typography>
            ) : planItem ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' }, gap: 0.75 }}>
                {REGISTER_MONTH_NAMES.map((month, index) => {
                  const amount = monthPlans.find((plan) => plan.month === index + 1)?.sum_plan ?? 0;
                  return <Box key={month} sx={{ p: 0.8, borderRadius: 1, bgcolor: '#F8FAFC', border: '1px solid', borderColor: '#E5EAF0' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>{month}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.35, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(Number(amount))}</Typography>
                  </Box>;
                })}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">Помесячный план не найден.</Typography>
            )}
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>Статус</Typography><StatusVisualBadge spec={rowStatusPresentation(rowRegistryStatus(item), item).primary} /></Box>
          {field('Обоснование', item.justification, true)}{field('Комментарий экономиста', item.comment, true)}
        </Box>
      </Box>
      {ANALYTICS_FIELD_KEYS.map((key) => (
        <Box key={key} sx={{ p: 1.25, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>{ANALYTICS_FIELD_LABELS[key]}</Typography>
          <EditableAnalyticsCell
            itemId={item.id}
            field={key}
            value={item[key] || ''}
            editable={canEditItemAnalytics(item)}
            confirmBeforeSave={canEditItemAnalytics(item)}
            multiline
          />
        </Box>
      ))}
      <Box sx={{ p: 1.5, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>Прикреплённые файлы</Typography>
        {files.length ? files.map((file) => (
          <Button
            key={file.id}
            size="small"
            startIcon={<VisibilityOutlinedIcon />}
            onClick={() => setPreviewFile(file)}
            aria-label={`Открыть предпросмотр ${file.original_name}`}
            sx={{ display: 'flex', justifyContent: 'flex-start', maxWidth: '100%', textTransform: 'none', overflow: 'hidden' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.original_name}</span>
          </Button>
        )) : <Typography variant="body2" color="text.secondary">Нет файлов</Typography>}
      </Box>
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2">История изменений</Typography>
          <Button size="small" onClick={() => onOpenHistory(item, true)}>Открыть полностью</Button>
        </Stack>
        <RequestHistoryPanel logs={logs} loading={logsPending} lineId={item.id} lineName={item.name} embedded showTabs />
      </Box>
      <Button component="a" href={`/requests/${item.request_id}?article_id=${encodeURIComponent(item.article_id)}&category_id=${encodeURIComponent(item.category_id)}`} target="_blank" rel="noopener noreferrer" variant="outlined" startIcon={<OpenInNewIcon />}>Открыть заявку</Button>
      </Stack>
      <FilePreviewDialog file={previewFile} open={!!previewFile} onClose={() => setPreviewFile(null)} />
    </Stack>}
  </Drawer>;
}

function RowActions({ item, user, onDecision, onOpen, onHistory }: { item: ApprovalRegisterRow; user: User; onDecision: (target: DecisionTarget) => void; onOpen: () => void; onHistory: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const workflowColumns = usesWorkflowStepColumns(user.role);
  const actionable = isRowActionable(item, user.role);
  const allowAmountEdit = (user.role === 'economist' && (item.is_approval_actionable || item.decision_editable_stage === 'economist'))
    || (user.role === 'employee' && (item.is_cfo_review_actionable || item.decision_editable_stage === 'cfo_review'));
  const approve = () => onDecision({
    rows: [item],
    decision: 'approved',
    amount: item.approved_sum || item.requested_sum,
    allowAmountEdit,
    allowDecisionChoice: user.role === 'employee' && (item.is_cfo_review_actionable || item.decision_editable_stage === 'cfo_review'),
  });
  const reject = () => onDecision({ rows: [item], decision: 'rejected' });
  // For economist/approver/zgd decisions live in «Ваше решение» — keep only history here.
  if (workflowColumns) {
    return (
      <Stack direction="row" spacing={0} justifyContent="flex-end" sx={{ '& .MuiIconButton-root': { p: 0.35 } }}>
        <Tooltip title="История изменений">
          <IconButton size="small" onClick={(event) => { event.stopPropagation(); onHistory(); }} aria-label="История изменений">
            <HistoryOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={0} justifyContent="flex-end" sx={{ '& .MuiIconButton-root': { p: 0.35 } }}>
      {actionable && <>
        <Tooltip title="Согласовать"><IconButton size="small" color="success" aria-label="Согласовать" onClick={(event) => { event.stopPropagation(); approve(); }}><CheckCircleOutlineIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
        <Tooltip title="Отклонить строку окончательно"><IconButton size="small" color="error" aria-label="Отклонить строку окончательно" onClick={(event) => { event.stopPropagation(); reject(); }}><CancelOutlinedIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
        <IconButton size="small" onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget); }} aria-label="Дополнительные действия"><MoreVertIcon sx={{ fontSize: 17 }} /></IconButton>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          <MenuItem dense onClick={() => { setAnchor(null); onDecision({ rows: [item], decision: 'approved_with_changes', amount: item.approved_sum || item.requested_sum }); }}>Согласовать с корректировкой</MenuItem>
          <MenuItem dense onClick={() => { setAnchor(null); onOpen(); }}>Открыть подробнее</MenuItem>
        </Menu>
      </>}
      <Tooltip title="История изменений">
        <IconButton size="small" onClick={(event) => { event.stopPropagation(); onHistory(); }} aria-label="История изменений">
          <HistoryOutlinedIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function GroupActions({
  group,
  user,
  onApproveCfo,
  onRejectCfo,
  onReturnCfo,
  onCompleteCfoReview,
  onWorkflowApprove,
  onWorkflowDecision,
  onWorkflowReject,
  onWorkflowReturn,
  onWorkflowFix,
  compact = false,
}: {
  group: ApprovalRegisterGroup;
  user: User;
  onApproveCfo: (group: ApprovalRegisterGroup) => void;
  onRejectCfo: (group: ApprovalRegisterGroup) => void;
  onReturnCfo: (group: ApprovalRegisterGroup) => void;
  onCompleteCfoReview: (group: ApprovalRegisterGroup) => void;
  onWorkflowApprove: (group: ApprovalRegisterGroup) => void;
  onWorkflowDecision: (group: ApprovalRegisterGroup) => void;
  onWorkflowReject: (group: ApprovalRegisterGroup) => void;
  onWorkflowReturn: (group: ApprovalRegisterGroup) => void;
  onWorkflowFix: (group: ApprovalRegisterGroup, unlock: boolean) => void;
  compact?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hasCfoReview = group.aggregates.cfo_review_actionable_requests > 0;
  // Revision rows also exist when an upper workflow step returns a position
  // to the economist.  They are not a new CFO review: the economist must use
  // the workflow return form, which sends the position to its direct lower
  // step.  Treat CFO return actions as employee-only.
  const hasCfo = user.role === 'employee' && groupHasCfoActions(group);
  const hasCfoDecision = groupHasCfoDecisionActions(group, user.role);
  const hasComplete = groupHasCfoCompleteActions(group);
  // A group exposes line decisions while a position is still being reviewed.
  // Once every line has a decision, the same group exposes the package
  // handoff/return actions.
  const hasWorkflowActions = groupHasWorkflowActions(group, user.role);
  const hasWorkflowPackage = groupHasWorkflowApprove(group, user.role);
  const hasWorkflowRevisionPackage = groupHasWorkflowRevision(group, user.role);
  const hasWorkflowReturn = groupHasWorkflowReturn(group, user.role);
  const hasZgdLock = user.role === 'zgd' && (group.aggregates.zgd_lock_positions || 0) > 0;
  const hasZgdUnlock = user.role === 'zgd'
    && (group.aggregates.fixed_rows || 0) > 0
    && group.aggregates.fixed_rows === group.aggregates.total_rows;
  const hasWorkflowDecision = hasWorkflowActions && !hasWorkflowPackage && !hasWorkflowRevisionPackage;
  const actualWorkflowReject = user.role === 'economist' && hasWorkflowActions && !hasWorkflowRevisionPackage;
  if (!hasCfo && !hasCfoDecision && !hasComplete && !hasWorkflowActions && !hasZgdUnlock) return null;

  const scopeLabel = group.type === 'article' ? 'статью' : group.type === 'cfo' ? 'ЦФО' : 'группу';
  const primaryApprove = hasCfoReview
    ? () => onApproveCfo(group)
    : hasWorkflowPackage
      ? () => onWorkflowApprove(group)
      : () => onWorkflowDecision(group);
  const primaryReject = hasCfoDecision
    ? () => onRejectCfo(group)
    : actualWorkflowReject
      ? () => onWorkflowReject(group)
      : () => onWorkflowReturn(group);
  const approveTitle = hasCfoReview
    ? `Согласовать все доступные строки ${scopeLabel === 'статью' ? 'статьи' : scopeLabel}`
    : hasWorkflowPackage
      ? `${workflowApproveLabel(user.role)} (${scopeLabel})`
      : `Согласовать доступные строки ${scopeLabel === 'статью' ? 'статьи' : scopeLabel}`;
  const rejectTitle = hasCfoDecision || actualWorkflowReject
    ? `Отклонить доступные строки ${scopeLabel === 'статью' ? 'статьи' : scopeLabel}`
    : hasCfo
      ? `Вернуть строки ${scopeLabel === 'статью' ? 'статьи' : scopeLabel} на доработку`
      : `Вернуть позиции ${scopeLabel === 'статью' ? 'статьи' : scopeLabel} на доработку`;
  const returnTitle = hasCfo
    ? `Вернуть строки ${scopeLabel === 'статью' ? 'статьи' : scopeLabel} на доработку`
    : `Вернуть позиции ${scopeLabel === 'статью' ? 'статьи' : scopeLabel} на доработку`;

  return (
    <Stack
      direction="row"
      spacing={0}
      justifyContent="flex-end"
      onClick={(event) => event.stopPropagation()}
      sx={{ '& .MuiIconButton-root': { p: 0.35 }, flex: compact ? '0 0 auto' : undefined }}
    >
      {hasComplete && (
        <Tooltip title="Завершить проверку заявок и передать согласованные строки в маршрут">
          <IconButton size="small" color="primary" aria-label="Завершить проверку заявок и передать согласованные строки в маршрут" onClick={() => onCompleteCfoReview(group)}>
            <DoneAllIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
      {(hasCfo || hasCfoDecision) && (
        <>
          {hasCfoReview && (
            <Tooltip title={approveTitle}>
              <IconButton size="small" color="success" aria-label={approveTitle} onClick={primaryApprove}>
                <CheckCircleOutlineIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
          {hasCfoDecision && (
            <Tooltip title={rejectTitle}>
              <IconButton size="small" color="error" aria-label={rejectTitle} onClick={primaryReject}>
                <CancelOutlinedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
          {hasCfo && (
            <Tooltip title={returnTitle}>
              <IconButton size="small" color="warning" aria-label={returnTitle} onClick={() => onReturnCfo(group)}>
                <RestartAltIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}
      {!hasCfo && hasWorkflowActions && (
        <>
          {(hasWorkflowPackage || hasWorkflowDecision) && (
            <Tooltip title={approveTitle}>
              <IconButton size="small" color="success" aria-label={approveTitle} onClick={primaryApprove}>
                <CheckCircleOutlineIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
          {actualWorkflowReject && (
            <Tooltip title={rejectTitle}>
              <IconButton size="small" color="error" aria-label={rejectTitle} onClick={primaryReject}>
                <CancelOutlinedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
          {user.role !== 'employee' && hasWorkflowReturn && (
            <Tooltip title={returnTitle}>
              <IconButton size="small" color="warning" aria-label={returnTitle} onClick={() => onWorkflowReturn(group)}>
                <RestartAltIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}
      {hasZgdLock && (
        <Tooltip title="Зафиксировать бюджет: после этого никто, включая ЗГД, не сможет изменить строки до разблокировки">
          <IconButton size="small" color="primary" aria-label="Зафиксировать бюджет" onClick={() => onWorkflowFix(group, false)}>
            <LockOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
      {hasZgdUnlock && (
        <Tooltip title="Разблокировать бюджет для доработки">
          <IconButton size="small" color="warning" aria-label="Разблокировать бюджет" onClick={() => onWorkflowFix(group, true)}>
            <LockOpenOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
      {hasCfoReview && hasWorkflowPackage && (
        <>
          <IconButton size="small" onClick={(event) => setAnchor(event.currentTarget)} aria-label="Дополнительные действия по позициям">
            <MoreVertIcon sx={{ fontSize: 17 }} />
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <MenuItem dense onClick={() => { setAnchor(null); onWorkflowApprove(group); }}>{workflowApproveLabel(user.role)}</MenuItem>
            {user.role !== 'employee' && hasWorkflowReturn && (
              <MenuItem dense onClick={() => { setAnchor(null); onWorkflowReturn(group); }}>На доработку (позиции)</MenuItem>
            )}
          </Menu>
        </>
      )}
    </Stack>
  );
}

function GroupYourDecisionCell({
  group,
  user,
  onApproveCfo,
  onRejectCfo,
  onReturnCfo,
  onCompleteCfoReview,
  onWorkflowApprove,
  onWorkflowDecision,
  onWorkflowReject,
  onWorkflowReturn,
  onWorkflowFix,
}: {
  group: ApprovalRegisterGroup;
  user: User;
  onApproveCfo: (group: ApprovalRegisterGroup) => void;
  onRejectCfo: (group: ApprovalRegisterGroup) => void;
  onReturnCfo: (group: ApprovalRegisterGroup) => void;
  onCompleteCfoReview: (group: ApprovalRegisterGroup) => void;
  onWorkflowApprove: (group: ApprovalRegisterGroup) => void;
  onWorkflowDecision: (group: ApprovalRegisterGroup) => void;
  onWorkflowReject: (group: ApprovalRegisterGroup) => void;
  onWorkflowReturn: (group: ApprovalRegisterGroup) => void;
  onWorkflowFix: (group: ApprovalRegisterGroup, unlock: boolean) => void;
}) {
  const summary = groupYourStepSummary(group.aggregates);
  const quick = canQuickDecideGroup(group, user.role);
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="flex-end"
      spacing={0.5}
      sx={{ minWidth: 0, maxWidth: '100%' }}
    >
      <Tooltip title={summary}>
        <Typography
          variant="body2"
          noWrap
          sx={{
            fontSize: 13,
            lineHeight: 1.25,
            color: quick ? 'warning.main' : 'text.primary',
            fontWeight: quick ? 600 : 400,
            minWidth: 0,
          }}
        >
          {summary}
        </Typography>
      </Tooltip>
      {quick ? (
        <GroupActions
          group={group}
          user={user}
          compact
          onApproveCfo={onApproveCfo}
          onRejectCfo={onRejectCfo}
          onReturnCfo={onReturnCfo}
          onCompleteCfoReview={onCompleteCfoReview}
          onWorkflowApprove={onWorkflowApprove}
          onWorkflowDecision={onWorkflowDecision}
          onWorkflowReject={onWorkflowReject}
          onWorkflowReturn={onWorkflowReturn}
          onWorkflowFix={onWorkflowFix}
        />
      ) : null}
    </Stack>
  );
}

function SelectionBar({
  selectionRoots,
  selectedRows,
  canApprove,
  canReject,
  canForward,
  forwarding,
  onApprove,
  onForward,
  onReject,
  onClear,
}: {
  selectionRoots: ApprovalRegisterGroup[];
  selectedRows: ApprovalRegisterRow[];
  canApprove: boolean;
  canReject: boolean;
  canForward: boolean;
  forwarding: boolean;
  onApprove: () => void;
  onForward: () => void;
  onReject: () => void;
  onClear: () => void;
}) {
  const isGroupSelection = selectionRoots.length > 0;
  const requestedSum = selectedRows.reduce((total, item) => total + item.requested_sum, 0);
  const summary = isGroupSelection
    ? (selectionRoots.length === 1
      ? `Выбрана группа: ${selectionRoots[0].name}`
      : `Выбрано групп: ${selectionRoots.length}`)
    : `Выбрано строк: ${selectedRows.length}`;

  return (
    <Paper variant="outlined" sx={{ px: 1.25, py: 0.75, borderColor: '#BFDBFE', bgcolor: '#F8FBFF' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) auto' }, gap: 1, alignItems: 'center' }}>
        <Stack spacing={0.15} sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.35, overflowWrap: 'anywhere' }}>
            {summary} · {selectedRows.length} строк
          </Typography>
          <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.35 }}>
            Запрошено: {money(requestedSum)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center" justifyContent="flex-end" sx={{ maxWidth: '100%' }}>
          {canApprove && <Button size="small" color="success" variant="outlined" startIcon={<CheckCircleOutlineIcon />} onClick={onApprove}>Согласовать</Button>}
          {canReject && <Button size="small" color="warning" variant="outlined" startIcon={<RestartAltIcon />} onClick={onReject}>
            На доработку
          </Button>}
          {canForward && <Tooltip title="Все обязательные строки обработаны: можно передать данные дальше.">
            <span><Button size="small" color="primary" variant="outlined" endIcon={<ChevronRightIcon />} disabled={forwarding} onClick={onForward}>{forwarding ? 'Передаём…' : 'Отправить дальше'}</Button></span>
          </Tooltip>}
          <Button size="small" color="inherit" startIcon={<CloseIcon />} onClick={onClear}>Очистить выбор</Button>
        </Stack>
      </Box>
    </Paper>
  );
}

function ForwardDetailsDialog({
  open,
  groups,
  lines,
  loading,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  groups: ApprovalRegisterGroup[];
  lines: ApprovalRegisterRow[];
  loading: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const requestedSum = lines.reduce((total, line) => total + (line.requested_sum || 0), 0);
  const approvedSum = lines.reduce((total, line) => total + (line.approved_sum || 0), 0);

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="xl"
      onClose={pending ? undefined : onClose}
      PaperProps={{ sx: { height: 'min(92vh, 820px)' } }}
    >
      <DialogTitle>Отправить на следующий этап?</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: { xs: 1.5, md: 2.5 } }}>
        <Typography color="text.secondary">
          Сохранённые решения будут переданы экономисту. Проверьте детализацию перед отправкой.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Групп: {groups.length} · строк: {lines.length} · запрошено: {money(requestedSum)} · согласовано: {money(approvedSum)}
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.5 }}>Детализация по строкам</Typography>
        {loading ? <LinearProgress /> : (
          <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Table stickyHeader size="small" sx={{ minWidth: 1060, '& td, & th': { borderRight: '1px solid', borderColor: 'rgba(15, 23, 42, 0.06)' } }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" sx={{ width: 48 }} />
                  <TableCell sx={{ minWidth: 230 }}>Строка</TableCell>
                  <TableCell sx={{ minWidth: 105 }}>Модуль</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Категория</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Статья</TableCell>
                  <TableCell align="right" sx={{ minWidth: 125 }}>Запрошено</TableCell>
                  <TableCell align="right" sx={{ minWidth: 125 }}>Согласовано</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Статус</TableCell>
                  <TableCell sx={{ minWidth: 230 }}>Комментарий к строке</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id} hover>
                    <TableCell padding="checkbox"><Checkbox checked disabled /></TableCell>
                    <TableCell sx={{ whiteSpace: 'normal', verticalAlign: 'top' }}>{line.name}</TableCell>
                    <TableCell sx={{ verticalAlign: 'top' }}>{line.module_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'normal', verticalAlign: 'top' }}>{line.category_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'normal', verticalAlign: 'top' }}>{line.article_name}</TableCell>
                    <TableCell align="right" sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{money(line.requested_sum)}</TableCell>
                    <TableCell align="right" sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{money(line.approved_sum)}</TableCell>
                    <TableCell sx={{ verticalAlign: 'top' }}>
                      <StatusVisualBadge spec={rowStatusPresentation(rowRegistryStatus(line), line).primary} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'normal', verticalAlign: 'top' }}>
                      <Typography variant="body2" color={line.comment?.trim() ? 'text.primary' : 'text.secondary'}>
                        {line.comment?.trim() || 'Без комментария'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !lines.length && (
                  <TableRow><TableCell colSpan={9} align="center">Нет строк для отправки</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions sx={{ px: { xs: 1.5, md: 2.5 }, py: 1.5 }}>
        <Button onClick={onClose} disabled={pending}>Отмена</Button>
        <Button
          variant="contained"
          color="primary"
          onClick={onConfirm}
          disabled={loading || pending || !lines.length}
        >
          {pending ? 'Передаём…' : 'Отправить дальше'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ApprovalRoutePanel({ requestId, user }: { requestId?: string; user: User }) {
  const { data: steps = [], isFetching } = useQuery({
    queryKey: ['approval-register-route', requestId],
    queryFn: async () => (await api.get<ApprovalStep[]>('/approval-route', { params: requestId ? { request_id: requestId } : undefined })).data,
  });
  const roleTitle = (step: ApprovalStep) => {
    if (step.unit_id) return 'Ответственный за ЦФО';
    if (step.is_economist_step) return 'Экономист ЦФО';
    if (step.user?.role === 'zgd') return 'ЗГД';
    return 'Согласующий';
  };
  const displayStatus = (step: ApprovalStep) => step.request_status || step.status;
  const {
    currentStep,
    expectedStepIds,
    nextStepIds,
    displaySteps,
    expectedModules,
  } = resolveApprovalRoutePanel(steps, user);
  const ownerLabel = (step: ApprovalStep) => {
    if (step.user?.profile) return [step.user.profile.last_name, step.user.profile.name].filter(Boolean).join(' ');
    if (step.user?.login) return step.user.login;
    if (step.unit?.name) return step.unit.name;
    if (step.cfo?.name) return step.cfo.name;
    return roleTitle(step);
  };
  const stateLabel = (step: ApprovalStep, active: boolean, isNext: boolean) => {
    if (displayStatus(step) === 'on_revision') {
      const count = step.readiness?.needs_revision || step.revision_positions_count || 0;
      return count ? `На доработке: ${count}` : 'На доработке';
    }
    if (active) return 'Текущий этап';
    if (isNext && !['approved', 'closed'].includes(displayStatus(step))) return 'Следующий этап';
    if (['approved', 'closed'].includes(displayStatus(step))) return 'Согласовано';
    if (displayStatus(step) === 'on_approval') return 'На согласовании';
    return 'Ожидает согласования';
  };
  const stateTone = (step: ApprovalStep, active: boolean, isNext: boolean) => {
    if (active || displayStatus(step) === 'on_approval') return { main: '#2563EB', line: '#93C5FD' };
    if (['approved', 'closed'].includes(displayStatus(step))) return { main: '#16A34A', line: '#86EFAC' };
    if (displayStatus(step) === 'on_revision') return { main: '#D97706', line: '#FCD34D' };
    if (isNext) return { main: '#64748B', line: '#CBD5E1' };
    return { main: '#64748B', line: '#E2E8F0' };
  };
  const moduleStatusLabel = (module: ApprovalRouteModule) => (
    module.request_statuses.length
      ? module.request_statuses
        .map(({ status, count }) => `${requestStatusLabels[status]}: ${count}`)
        .join(' · ')
      : 'Заявок нет'
  );
  const moduleOwnerName = (module: ApprovalRouteModule) => {
    if (module.responsible?.profile) {
      return [module.responsible.profile.last_name, module.responsible.profile.name].filter(Boolean).join(' ');
    }
    return module.responsible?.login || 'Не назначен';
  };
  const moduleTone = (module: ApprovalRouteModule) => {
    const statuses = module.request_statuses.map(({ status }) => status);
    if (statuses.includes('on_review')) return { main: '#2563EB', line: '#93C5FD' };
    if (statuses.length > 0 && statuses.every((status) => status === 'approved')) return { main: '#16A34A', line: '#86EFAC' };
    return { main: '#64748B', line: '#CBD5E1' };
  };
  const routeItems = [
    ...expectedModules.map((module) => ({ kind: 'module' as const, key: `module:${module.id}`, module })),
    ...displaySteps.map((step) => ({ kind: 'step' as const, key: step.id, step })),
  ];
  type RouteItem = (typeof routeItems)[number];
  const routeGroups: Array<{ key: string; items: RouteItem[]; startIndex: number }> = [];
  routeItems.forEach((item, index) => {
    const key = item.kind === 'module'
      ? 'modules'
      : item.step.id === currentStep?.id
        ? 'current'
        : expectedStepIds.includes(item.step.id)
          ? 'expected'
          : nextStepIds.includes(item.step.id)
            ? 'next'
            : `step:${item.step.id}`;
    const lastGroup = routeGroups[routeGroups.length - 1];
    if (lastGroup?.key === key) {
      lastGroup.items.push(item);
    } else {
      routeGroups.push({ key, items: [item], startIndex: index });
    }
  });
  return (
    <Paper variant="outlined" sx={{ width: { xl: 276 }, flex: { xl: '0 0 276px' }, p: 1.25, borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5, bgcolor: '#fff', position: { xl: 'sticky' }, top: { xl: 8 }, alignSelf: 'flex-start' }}>
      <Stack direction="row" spacing={0.65} alignItems="center" sx={{ mb: 1.1 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 12.5 }}>Маршрут согласования</Typography>
      </Stack>
      {isFetching && <Typography variant="caption" color="text.secondary">Загрузка маршрута…</Typography>}
      {!isFetching && !steps.length && <Typography variant="caption" color="text.secondary">Маршрут для текущего набора пока не определён.</Typography>}
      <Stack spacing={0.15}>
        {routeGroups.map((group) => (
          <Box
            key={group.key}
            sx={{
              pl: 0.55,
              ...(group.items.length > 1 || group.key === 'modules' ? {
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: 4,
                  bottom: 4,
                  width: 3,
                  borderRadius: 999,
                  bgcolor: group.key === 'expected' || group.key === 'modules' ? '#93C5FD' : '#CBD5E1',
                },
              } : {}),
            }}
          >
            {group.items.map((item, itemIndex) => {
              const index = group.startIndex + itemIndex;
              const isModule = item.kind === 'module';
              const completed = isModule
                ? item.module.request_statuses.length > 0
                  && item.module.request_statuses.every(({ status }) => status === 'approved')
                : ['approved', 'closed'].includes(displayStatus(item.step));
              const active = !isModule && item.step.id === currentStep?.id;
              const isNext = !isModule && nextStepIds.includes(item.step.id);
              const tone = isModule ? moduleTone(item.module) : stateTone(item.step, active, isNext);
              return (
                <Stack key={item.key} direction="row" spacing={0.85} alignItems="stretch" sx={{ position: 'relative' }}>
                  <Stack alignItems="center" sx={{ width: 20, flex: '0 0 20px', alignSelf: 'stretch', position: 'relative' }}>
                    <Box aria-current={active ? 'step' : undefined} sx={{ width: 10, height: 10, mt: 0.45, zIndex: 1, borderRadius: '50%', bgcolor: completed || active || (!isModule && displayStatus(item.step) === 'on_revision') ? tone.main : '#fff', border: '1px solid', borderColor: tone.main }} />
                    {index < routeItems.length - 1 && <Box sx={{ position: 'absolute', zIndex: 0, top: 14, bottom: -9, left: '50%', width: '1px', transform: 'translateX(-50%)', bgcolor: tone.line }} />}
                  </Stack>
                  <Box sx={{ pb: index < routeItems.length - 1 ? 1.15 : 0, minWidth: 0 }}>
                    <Typography variant="caption" fontWeight={active || completed ? 700 : 600} sx={{ color: tone.main, lineHeight: 1.25, display: 'block', fontSize: 11.5 }}>
                      {isModule ? item.module.name : roleTitle(item.step)}
                    </Typography>
                    {isModule ? (
                      <>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, lineHeight: 1.2, display: 'block' }}>{moduleOwnerName(item.module)}</Typography>
                        <Typography variant="caption" sx={{ color: tone.main, fontSize: 10.5, lineHeight: 1.2, display: 'block' }}>{moduleStatusLabel(item.module)}</Typography>
                      </>
                    ) : (
                      <>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, lineHeight: 1.2, display: 'block' }}>{ownerLabel(item.step)}</Typography>
                        <Typography variant="caption" sx={{ mt: 0.15, color: tone.main, fontSize: 10.5, lineHeight: 1.2, display: 'block' }}>{stateLabel(item.step, active, isNext)}</Typography>
                        {stepReadinessLabels(item.step).map((label) => (
                          <Typography key={label} variant="caption" sx={{ mt: 0.15, color: 'text.secondary', fontSize: 10.5, lineHeight: 1.2, display: 'block' }}>
                            {label}
                          </Typography>
                        ))}
                      </>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Box>
        ))}
      </Stack>
      <Divider sx={{ my: 1.15 }} />
      <Alert icon={<InfoOutlinedIcon sx={{ fontSize: 16 }} />} severity="info" variant="standard" sx={{ py: 0.65, px: 0.75, bgcolor: '#EFF6FF', color: '#2563EB', '& .MuiAlert-icon': { mr: 0.65, py: 0.1 }, '& .MuiAlert-message': { fontSize: 10.5, lineHeight: 1.4 } }}>
        Выберите строки для массового согласования или возврата на доработку.
      </Alert>
    </Paper>
  );
}

const VirtualRowContext = createContext<React.HTMLAttributes<HTMLTableRowElement> & { ref?: React.Ref<HTMLTableRowElement>; 'data-index'?: number }>({});

function RegistryRowCells({ item, columns, widths, selected, active, user, approvalMode, onSelect, onActive, onDecision, onSaveRowDecision, onOpen, onHistory, structureLevel = 0 }: { item: ApprovalRegisterRow; columns: typeof REGISTRY_COLUMNS; widths: Record<RegistryColumnId, number>; selected: boolean; active: boolean; user: User; approvalMode: boolean; onSelect: (checked: boolean) => void; onActive: () => void; onDecision: (target: DecisionTarget) => void; onSaveRowDecision: (row: ApprovalRegisterRow, decision: RowDecision, amount: number, comment?: string) => void; onOpen: () => void; onHistory: () => void; structureLevel?: number }) {
  const requestPointRevision = useContext(PointRevisionContext);
  const registerView = useContext(RegisterViewContext);
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const workflowColumns = usesWorkflowStepColumns(user.role);
  const actionEnabled = approvalMode && isRowActionable(item, user.role);
  // A line-level return belongs only to the responsible CFO.  A reviewer
  // returns selected lines through the group dialog, where one comment is
  // recorded for the grouping event.  Reusing the CFO endpoint here made an
  // approver request fail with «Заявка относится к другому ЦФО».
  const canReturnPointForCfo = user.role === 'employee';
  const moduleRevisionEditable = !item.is_module_revision || registerView === 'module';
  const amountEditable = approvalMode
    && moduleRevisionEditable
    && canEditApprovedAmount(user.role, item);
  const commentEditable = isRowActionable(item, user.role)
    || Boolean(item.is_revision_actionable)
    || Boolean(item.is_cfo_module_revision_actionable)
    || Boolean(item.is_decision_editable);
  const statusEditable = actionEnabled;
  // Every row action exposed to the responsible-CFO register must go through
  // the same decision dialog.  Keep this based on the rendered action rather
  // than only on the CFO flag: older register responses may expose the
  // actionability through status_context instead.
  const cfoDecisionRequiresConfirmation = user.role === 'employee' && actionEnabled;
  const decisionDialogAllowsAmountEdit = (
    user.role === 'economist'
    && (item.is_approval_actionable || item.decision_editable_stage === 'economist')
  ) || cfoDecisionRequiresConfirmation;
  const rowStatus = rowRegistryStatus(item);
  const [draftFact, setDraftFact] = useState(item.approved_sum);
  const [hasEnteredFact, setHasEnteredFact] = useState(item.approved_sum !== 0);
  const draftFactRef = useRef(item.approved_sum);
  const hasEnteredFactRef = useRef(item.approved_sum !== 0);
  const [draftComment, setDraftComment] = useState(item.comment || '');
  const draftCommentRef = useRef(item.comment || '');
  useEffect(() => {
    setDraftFact(item.approved_sum);
    setHasEnteredFact(item.approved_sum !== 0);
    draftFactRef.current = item.approved_sum;
    hasEnteredFactRef.current = item.approved_sum !== 0;
    setDraftComment(item.comment || '');
    draftCommentRef.current = item.comment || '';
  }, [item.approved_sum, item.comment, item.id]);
  const updateDraftFact = (amount: number) => {
    setDraftFact(amount);
    setHasEnteredFact(true);
    draftFactRef.current = amount;
    hasEnteredFactRef.current = true;
  };
  const cancelDraftFact = () => {
    const hasSavedFact = item.approved_sum !== 0;
    setDraftFact(item.approved_sum);
    setHasEnteredFact(hasSavedFact);
    draftFactRef.current = item.approved_sum;
    hasEnteredFactRef.current = hasSavedFact;
  };
  const updateDraftComment = (comment: string) => {
    setDraftComment(comment);
    draftCommentRef.current = comment;
  };
  const saveComment = useMutation({
    mutationFn: async (comment: string) => (await api.patch<BudgetItem>(`/items/${item.id}`, { comment })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['registry-request-items', item.request_id] });
    },
    onError: (error) => {
      updateDraftComment(item.comment || '');
      toast(getApiErrorMessage(error, 'Не удалось сохранить комментарий'), 'error');
    },
  });
  // A fixed position is immutable for every participant, including ZGD.  The
  // unlock control is intentionally kept on the row where the lock is shown,
  // so ZGD does not have to search through a separate group menu to reopen it.
  const unfixPosition = useMutation({
    mutationFn: async () => {
      if (!item.position_id) throw new Error('У строки нет позиции для разблокировки');
      return api.post(`/cfo-positions/${item.position_id}/unfix`, {
        // The endpoint accepts the same revision payload as the existing
        // position actions.  The service unlocks the complete position; the
        // visible row only supplies a valid item id for payload validation.
        items: [{ item_id: item.id }],
        comment: '',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
      toast('Фиксация бюджета снята. Строки снова доступны для доработки.', 'success');
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось снять фиксацию бюджета'), 'error'),
  });
  const commitComment = (comment: string) => {
    updateDraftComment(comment);
    saveComment.mutate(comment);
  };
  const commitDecision = (decision: RegistryRowDecision, amount: number) => {
    const resolvedDecision = decision === 'approved' && amount !== item.requested_sum
      ? 'approved_with_changes'
      : decision;
    if (cfoDecisionRequiresConfirmation) {
      onDecision({
        rows: [item],
        decision: resolvedDecision,
        amount,
        allowAmountEdit: true,
        allowDecisionChoice: true,
        comment: draftCommentRef.current,
      });
      return;
    }
    if (decision === 'approved' && amount !== item.requested_sum) {
      if (item.is_final_approval_actionable) {
        // ZGD fixes the result agreed at the preceding step; it does not
        // reinterpret an existing correction as a new amount decision.
        onSaveRowDecision(item, 'approved', amount, draftCommentRef.current);
        return;
      }
      onDecision({ rows: [item], decision: 'approved_with_changes', amount, comment: draftCommentRef.current });
      return;
    }
    if (statusEditable && (item.is_approval_actionable || item.is_cfo_review_actionable || item.is_decision_editable)) {
      onSaveRowDecision(item, decision, amount, draftCommentRef.current);
      return;
    }
    onDecision({
      rows: [item],
      decision,
      amount,
      allowAmountEdit: decisionDialogAllowsAmountEdit,
      comment: draftCommentRef.current,
    });
  };
  const openStatusDecision = (decision: RegistryRowDecision, amount = item.approved_sum || item.requested_sum) => {
    onDecision({
      rows: [item],
      decision,
      amount,
      allowAmountEdit: decisionDialogAllowsAmountEdit,
      comment: draftCommentRef.current,
    });
  };
  const approvePoint = () => {
    const amount = user.role === 'approver' || user.role === 'zgd'
      ? item.requested_sum
      : resolvePointApprovalAmount(
        item.requested_sum,
        draftFactRef.current,
        hasEnteredFactRef.current,
      );
    commitDecision('approved', amount);
  };
  const cellTextSx = { fontSize: 13, lineHeight: 1.25 };
  const cells: Partial<Record<RegistryColumnId, React.ReactNode>> = {
    select: approvalMode && actionEnabled
      ? <Checkbox size="small" checked={selected} onChange={(_, checked) => onSelect(checked)} sx={{ p: 0.35 }} inputProps={{ 'aria-label': `Выбрать ${item.name}` }} />
      : null,
    structure: (
      <Box sx={{ pl: structureLevel * 1.15, minWidth: 0 }}>
        <Tooltip title={item.name || '—'}>
          <Typography variant="body2" noWrap sx={{ ...cellTextSx, fontWeight: 500 }}>{item.name}</Typography>
        </Tooltip>
        <Typography
          component="button"
          type="button"
          variant="caption"
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
          sx={{
            display: 'inline',
            p: 0,
            m: 0,
            border: 0,
            background: 'none',
            color: 'primary.main',
            cursor: 'pointer',
            fontSize: 11,
            lineHeight: 1.2,
            textAlign: 'left',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          Подробнее
        </Typography>
      </Box>
    ),
    requested: (
      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.35}>
        <Tooltip title="Показать план по месяцам" disableInteractive>
          <IconButton
            size="small"
            onClick={(event) => { event.stopPropagation(); onOpen(); }}
            aria-label={`Показать план по месяцам: ${item.name}`}
            sx={{ p: 0.15, color: 'primary.main', flexShrink: 0 }}
          >
            <CalendarMonthOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        <Typography variant="body2" sx={cellTextSx}>{money(item.requested_sum)}</Typography>
      </Stack>
    ),
    approved: (
      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
      <InlineEditMoneyCell
        value={draftFact}
        editable={amountEditable}
        formatValue={money}
        parseValue={parseMoneyInput}
        validate={(amount) => amount >= 0}
        ariaLabel="Фактическая сумма"
        tooltip={amountEditable ? 'Изменить факт в рамках вашего шага' : 'Факт можно изменить только на назначенном вам шаге'}
        onDraftChange={updateDraftFact}
        onCancel={cancelDraftFact}
        saveOnBlur={false}
        onCommit={updateDraftFact}
      />
      </Stack>
    ),
    rejected: <Typography variant="body2" sx={{ ...cellTextSx, color: draftFact - item.requested_sum ? 'warning.dark' : 'text.secondary' }}>{money(draftFact - item.requested_sum)}</Typography>,
    your_step: workflowColumns ? (
      <RegistryYourDecisionCell
        item={item}
        active={statusEditable}
        amountEditable={amountEditable}
        onCommit={commitDecision}
        onDecision={openStatusDecision}
      />
    ) : null,
    status: (
      <Stack spacing={0.25} alignItems="flex-start" sx={{ width: '100%', minWidth: 0 }}>
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <RegistryStatusCell
            status={rowStatus}
            item={item}
            onPrimaryAction={user.role === 'zgd' && item.fixed && item.position_id ? () => unfixPosition.mutate() : undefined}
            primaryActionLabel="Снять фиксацию бюджета"
            primaryActionDisabled={unfixPosition.isPending}
          />
        </Box>
          {actionEnabled && (
            <Stack direction="row" spacing={0} sx={{ '& .MuiIconButton-root': { p: 0.35 } }}>
              <Tooltip title="Согласовать строку">
                <IconButton
                  size="small"
                  color="success"
                  aria-label="Согласовать строку"
                  onClick={(event) => { event.stopPropagation(); approvePoint(); }}
                >
                  <CheckCircleOutlineIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              {(user.role === 'employee' || user.role === 'economist') && (
                <Tooltip title="Отклонить строку окончательно">
                  <IconButton
                    size="small"
                    color="error"
                    aria-label="Отклонить строку окончательно"
                    onClick={(event) => { event.stopPropagation(); openStatusDecision('rejected'); }}
                  >
                    <CancelOutlinedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              {user.role === 'economist' && actionEnabled && (
                <Tooltip title="Отметить строку на доработку">
                  <IconButton
                    size="small"
                    color="warning"
                    aria-label="Отметить строку на доработку"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDecision({ rows: [item], decision: 'on_revision', comment: draftCommentRef.current });
                    }}
                  >
                    <RestartAltIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              {canReturnPointForCfo && (
                <Tooltip title="Вернуть на доработку">
                  <IconButton
                    size="small"
                    color="warning"
                    aria-label="Вернуть строку на доработку"
                    onClick={(event) => { event.stopPropagation(); requestPointRevision(item); }}
                  >
                    <RestartAltIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          )}
      </Stack>
    ),
    justification: (
      <Tooltip title={item.justification || '—'}>
        <Typography variant="body2" noWrap sx={cellTextSx}>{item.justification || '—'}</Typography>
      </Tooltip>
    ),
    comment: (
      <InlineEditTextCell
        value={draftComment}
        editable={commentEditable}
        multiline
        pending={saveComment.isPending}
        placeholder="—"
        ariaLabel="Комментарий к строке"
        tooltip="Нажмите, чтобы изменить комментарий"
        onCommit={commitComment}
      />
    ),
    files: item.files_count ? (
      <Stack direction="row" justifyContent="center" alignItems="center" spacing={0.25}>
        <Typography variant="body2" sx={cellTextSx}>{item.files_count}</Typography>
        <Tooltip title="Открыть прикреплённые файлы" disableInteractive>
          <IconButton
            size="small"
            onClick={(event) => { event.stopPropagation(); onOpen(); }}
            aria-label={`Открыть прикреплённые файлы: ${item.name}`}
            sx={{ p: 0.15, color: 'primary.main' }}
          >
            <VisibilityOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    ) : <Typography variant="body2" align="center" sx={cellTextSx}>—</Typography>,
    actions: workflowColumns ? null : <RowActions item={item} user={user} onDecision={onDecision} onOpen={onOpen} onHistory={onHistory} />,
    ...ANALYTICS_FIELD_KEYS.reduce((result, key) => {
      const fieldValue = item[key] || '';
      const editable = canEditItemAnalytics(item);
      result[key] = (
        <EditableAnalyticsCell
          itemId={item.id}
          field={key}
          value={fieldValue}
          editable={editable}
          confirmBeforeSave={editable}
        />
      );
      return result;
    }, {} as Partial<Record<RegistryColumnId, React.ReactNode>>),
  };
  const virtualRow = useContext(VirtualRowContext);
  return <TableRow {...virtualRow} hover selected={active} tabIndex={0} onClick={onActive} onDoubleClick={onOpen} className="approval-register-row approval-register-row--item" sx={{ '& td': { py: 0.35, px: 0.75, minHeight: 40, bgcolor: '#fff' }, '&.Mui-selected td': { bgcolor: '#edf5ff' }, '&:hover td': { bgcolor: '#f7fbff' } }}>
    {columns.map((column) => {
      const fixed = column.id === 'select' || column.id === 'structure';
      const align = ['requested', 'approved', 'rejected'].includes(column.id) ? 'right' : ['select', 'files'].includes(column.id) ? 'center' : 'left';
      return <TableCell key={column.id} align={align} sx={{ width: widths[column.id], minWidth: widths[column.id], maxWidth: widths[column.id], overflow: 'hidden', position: fixed ? 'sticky' : 'static', left: column.id === 'structure' ? widths.select : 0, zIndex: fixed ? 2 : 0, bgcolor: '#fff !important', borderRight: '1px solid', borderColor: 'rgba(15, 23, 42, 0.06)', fontSize: 13 }}>{cells[column.id]}</TableCell>;
    })}
  </TableRow>;
}

function RegisterPaginationRow({
  columnsCount,
  page,
  pageSize,
  pagination,
  onPageChange,
  onPageSizeChange,
  indent = 5,
}: {
  columnsCount: number;
  page: number;
  pageSize: number;
  pagination: NonNullable<ApprovalRegisterRowsResponse['pagination']>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  indent?: number;
}) {
  const rangeStart = pagination.total_items ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = pagination.total_items ? Math.min(page * pageSize, pagination.total_items) : 0;
  const virtualRow = useContext(VirtualRowContext);
  return (
    <TableRow {...virtualRow} className="approval-register-request-pagination">
      <TableCell colSpan={columnsCount} sx={{ p: 0, bgcolor: '#fafbfd', borderTop: '1px solid rgba(15, 23, 42, 0.06)' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: '100%', minHeight: 34 }}>
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            className="register-pagination-controls"
            sx={{
              position: 'sticky',
              left: 0,
              zIndex: 4,
              bgcolor: '#fafbfd',
              px: 1.25,
              pl: indent,
              py: 0.45,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>Строк на странице:</Typography>
            <Select
              size="small"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              sx={{ height: 24, fontSize: 11, minWidth: 56, '& .MuiSelect-select': { py: '2px !important' } }}
            >
              {[25, 50, 100, 200].map((value) => <MenuItem key={value} value={value} dense sx={{ fontSize: 12 }}>{value}</MenuItem>)}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              {`${rangeStart}–${rangeEnd} из ${pagination.total_items}`}
            </Typography>
          </Stack>
          {pagination.total_pages > 1 ? (
            <Box
              className="register-pagination-pages"
              sx={{
                position: 'sticky',
                right: 0,
                zIndex: 4,
                bgcolor: '#fafbfd',
                px: 1.25,
                py: 0.45,
              }}
            >
              <Pagination
                size="small"
                page={page}
                count={pagination.total_pages}
                onChange={(_, value) => onPageChange(value)}
                siblingCount={1}
                boundaryCount={1}
                sx={{ '& .MuiPaginationItem-root': { minWidth: 24, height: 24, fontSize: 11 } }}
              />
            </Box>
          ) : null}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

function RegisterRows({ group, expanded, filters, columns, widths, selectedIds, activeId, user, approvalMode, onToggleSelected, onActive, onDecision, onSaveRowDecision, onOpen, onHistory, onItems, requestId, visibleItemIds, columnSort }: { group: ApprovalRegisterGroup; expanded: boolean; filters: RegistryFilters; columns: typeof REGISTRY_COLUMNS; widths: Record<RegistryColumnId, number>; selectedIds: Set<string>; activeId: string | null; user: User; approvalMode: boolean; onToggleSelected: (item: ApprovalRegisterRow, checked: boolean) => void; onActive: (item: ApprovalRegisterRow) => void; onDecision: (target: DecisionTarget) => void; onSaveRowDecision: (row: ApprovalRegisterRow, decision: RowDecision, amount: number, comment?: string) => void; onOpen: (item: ApprovalRegisterRow) => void; onHistory: (item: ApprovalRegisterRow) => void; onItems: (groupId: string, items: ApprovalRegisterRow[]) => void; requestId?: string; visibleItemIds: Set<string> | null; columnSort: TableSortState<RegistryColumnId> | null }) {
  const remoteQuery = useContext(RegisterQueryContext);
  const filteredItemsByGroup = useContext(FilteredRegisterItemsContext);
  const filteredItems = filteredItemsByGroup?.get(group.id);
  const usesColumnFilteredItems = filteredItemsByGroup !== null;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Number(sessionStorage.getItem(REQUEST_PAGE_SIZE_KEY)) || 50);
  useEffect(() => { setPage(1); }, [group.id, remoteQuery, filters.flow, filters.status, filters.budgetYear, filters.search, ...ANALYTICS_FIELD_KEYS.map((key) => filters[key])]);
  const { data, isFetching, error } = useQuery({
    queryKey: ['approval-register-rows', group.id, group.module_id, group.article_id, group.category_id, requestId, page, pageSize, filters, remoteQuery],
    queryFn: async ({ signal }) => (await api.post<ApprovalRegisterRowsResponse>('/approval-register/query', {
      ...remoteQuery, mode: 'rows', scope: group.scope || {}, page, page_size: pageSize,
    }, { signal })).data,
    enabled: expanded && !usesColumnFilteredItems,
    placeholderData: (previous) => previous,
  });
  useEffect(() => { if (data && !usesColumnFilteredItems) onItems(group.id, data.items); }, [data, group.id, onItems, usesColumnFilteredItems]);
  const displayItems = useMemo(() => {
    let items = usesColumnFilteredItems ? filteredItems || [] : data?.items || [];
    if (visibleItemIds) items = items.filter((item) => visibleItemIds.has(item.id));
    return sortRegisterItems(items, columnSort);
  }, [columnSort, data?.items, filteredItems, usesColumnFilteredItems, visibleItemIds]);
  if (!expanded) return null;
  const columnsCount = columns.length;
  const pagination = data?.pagination;
  return <>
    {!usesColumnFilteredItems && isFetching && !data && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5, py: 0.5 }}><Typography variant="caption" color="text.secondary">Загрузка строк…</Typography></TableCell></TableRow>}
    {!usesColumnFilteredItems && error && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5 }}><Alert severity="error" sx={{ py: 0.25 }}>Не удалось загрузить строки заявки. Повторите попытку.</Alert></TableCell></TableRow>}
    {displayItems.map((item) => <RegistryRowCells key={item.id} item={item} columns={columns} widths={widths} selected={selectedIds.has(item.id)} active={activeId === item.id} user={user} approvalMode={approvalMode} onSelect={(checked) => onToggleSelected(item, checked)} onActive={() => onActive(item)} onDecision={onDecision} onSaveRowDecision={onSaveRowDecision} onOpen={() => onOpen(item)} onHistory={() => onHistory(item)} />)}
    {(data || usesColumnFilteredItems) && !displayItems.length && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5 }}><Typography variant="caption" color="text.secondary">Строк заявки не найдено.</Typography></TableCell></TableRow>}
    {!usesColumnFilteredItems && pagination && pagination.total_items > 0 && (
      <RegisterPaginationRow
        columnsCount={columnsCount}
        page={page}
        pageSize={pageSize}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
          sessionStorage.setItem(REQUEST_PAGE_SIZE_KEY, String(nextSize));
        }}
      />
    )}
  </>;
}

function GroupAggregateAmount({ group, field }: { group: ApprovalRegisterGroup; field: 'requested_sum' | 'approved_sum' | 'difference' }) {
  const current = group.aggregates[field];
  const source = group.source_aggregates?.[field];
  const filtered = source !== undefined && source !== current;
  return (
    <Box>
      <Typography variant="body2" sx={{ fontSize: 13 }}>{money(current)}</Typography>
      {filtered && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: 10.5 }}>всего {money(source)}</Typography>}
    </Box>
  );
}

function groupRowsCaption(group: ApprovalRegisterGroup) {
  const sourceRows = group.source_aggregates?.total_rows;
  return sourceRows !== undefined && sourceRows !== group.aggregates.total_rows
    ? `${group.aggregates.total_rows} из ${sourceRows} строк`
    : `${group.aggregates.total_rows} строк`;
}

function ModuleGroupHeaderRow({
  module,
  level,
  columns,
  widths,
  user,
  view,
}: {
  module: ApprovalRegisterGroup;
  level: number;
  columns: typeof REGISTRY_COLUMNS;
  widths: Record<RegistryColumnId, number>;
  user: User;
  view: RegistryView;
}) {
  const virtualRow = useContext(VirtualRowContext);
  const cells: Partial<Record<RegistryColumnId, React.ReactNode>> = {
    select: null,
    structure: (
      <Stack direction="row" alignItems="center" spacing={0.25} sx={{ pl: level * 1.15, minWidth: 0 }}>
        <Box sx={{ width: 22, flex: '0 0 auto' }} />
        <Box minWidth={0}>
          <Tooltip title={module.name || '—'}>
            <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 13, lineHeight: 1.25 }}>{module.name}</Typography>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1.2 }}>
            {module.label} · {groupRowsCaption(module)}{groupStructureCaptionExtras(module, user)}
          </Typography>
        </Box>
      </Stack>
    ),
    requested: <GroupAggregateAmount group={module} field="requested_sum" />,
    approved: <GroupAggregateAmount group={module} field="approved_sum" />,
    rejected: <GroupAggregateAmount group={module} field="difference" />,
    your_step: usesWorkflowStepColumns(user.role) ? <Typography variant="body2" sx={{ fontSize: 13 }}>{groupYourStepSummary(module.aggregates)}</Typography> : null,
    status: <RegistryGroupStatusCell status={groupRegistryStatus(module.aggregates)} aggregates={module.aggregates} />,
    justification: '—',
    comment: '—',
    files: '—',
    actions: null,
    ...ANALYTICS_FIELD_KEYS.reduce((result, key) => {
      result[key] = '—';
      return result;
    }, {} as Partial<Record<RegistryColumnId, React.ReactNode>>),
  };
  return (
    <TableRow {...virtualRow} hover className="approval-register-row" sx={{ '& td': { py: 0.25, px: 0.75, height: 34, bgcolor: '#fff', fontSize: 13 } }}>
      {columns.map((column) => {
        const fixed = column.id === 'select' || column.id === 'structure';
        return (
          <TableCell
            key={column.id}
            align={['requested', 'approved', 'rejected', 'pending'].includes(column.id) ? 'right' : column.id === 'select' ? 'center' : 'left'}
            sx={{
              width: widths[column.id],
              minWidth: widths[column.id],
              maxWidth: widths[column.id],
              overflow: 'hidden',
              position: fixed ? 'sticky' : 'static',
              left: column.id === 'structure' ? widths.select : 0,
              zIndex: fixed ? 2 : 0,
              bgcolor: '#fff !important',
              borderRight: '1px solid',
              borderColor: 'rgba(15, 23, 42, 0.06)',
            }}
          >
            {cells[column.id]}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function CategoryModuleRows({
  category,
  modules,
  level,
  expanded,
  filters,
  columns,
  widths,
  selectedIds,
  activeId,
  user,
  approvalMode,
  view,
  onToggleSelected,
  onActive,
  onDecision,
  onSaveRowDecision,
  onOpen,
  onHistory,
  onItems,
  requestId,
  visibleItemIds,
  columnSort,
}: {
  category: ApprovalRegisterGroup;
  modules: ApprovalRegisterGroup[];
  level: number;
  expanded: boolean;
  filters: RegistryFilters;
  columns: typeof REGISTRY_COLUMNS;
  widths: Record<RegistryColumnId, number>;
  selectedIds: Set<string>;
  activeId: string | null;
  user: User;
  approvalMode: boolean;
  view: RegistryView;
  onToggleSelected: (item: ApprovalRegisterRow, checked: boolean) => void;
  onActive: (item: ApprovalRegisterRow) => void;
  onDecision: (target: DecisionTarget) => void;
  onSaveRowDecision: (row: ApprovalRegisterRow, decision: RowDecision, amount: number, comment?: string) => void;
  onOpen: (item: ApprovalRegisterRow) => void;
  onHistory: (item: ApprovalRegisterRow) => void;
  onItems: (groupId: string, items: ApprovalRegisterRow[]) => void;
  requestId?: string;
  visibleItemIds: Set<string> | null;
  columnSort: TableSortState<RegistryColumnId> | null;
}) {
  const remoteQuery = useContext(RegisterQueryContext);
  const filteredItemsByGroup = useContext(FilteredRegisterItemsContext);
  const filteredItems = filteredItemsByGroup?.get(category.id);
  const usesColumnFilteredItems = filteredItemsByGroup !== null;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Number(sessionStorage.getItem(REQUEST_PAGE_SIZE_KEY)) || 50);
  useEffect(() => { setPage(1); }, [category.id, remoteQuery, filters.flow, filters.status, filters.budgetYear, filters.search, ...ANALYTICS_FIELD_KEYS.map((key) => filters[key])]);
  const { data, isFetching, error } = useQuery({
    queryKey: ['approval-register-rows', category.id, category.category_id, category.article_id, requestId, page, pageSize, filters, remoteQuery],
    queryFn: async ({ signal }) => (await api.post<ApprovalRegisterRowsResponse>('/approval-register/query', {
      ...remoteQuery, mode: 'rows', scope: category.scope || {}, page, page_size: pageSize,
    }, { signal })).data,
    enabled: expanded && !usesColumnFilteredItems,
    placeholderData: (previous) => previous,
  });
  useEffect(() => { if (data && !usesColumnFilteredItems) onItems(category.id, data.items); }, [category.id, data, onItems, usesColumnFilteredItems]);
  const displayItems = useMemo(() => {
    let items = usesColumnFilteredItems ? filteredItems || [] : data?.items || [];
    if (visibleItemIds) items = items.filter((item) => visibleItemIds.has(item.id));
    return sortRegisterItems(items, columnSort);
  }, [columnSort, data?.items, filteredItems, usesColumnFilteredItems, visibleItemIds]);
  const itemsByModule = useMemo(() => {
    const map = new Map<string, ApprovalRegisterRow[]>();
    displayItems.forEach((item) => {
      const bucket = map.get(item.module_id) || [];
      bucket.push(item);
      map.set(item.module_id, bucket);
    });
    return map;
  }, [displayItems]);
  if (!expanded) return null;
  const columnsCount = columns.length;
  const pagination = data?.pagination;
  const modulesOnPage = modules.filter((module) => (itemsByModule.get(module.module_id) || []).length > 0);
  return <>
    {!usesColumnFilteredItems && isFetching && !data && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5, py: 0.5 }}><Typography variant="caption" color="text.secondary">Загрузка строк…</Typography></TableCell></TableRow>}
    {!usesColumnFilteredItems && error && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5 }}><Alert severity="error" sx={{ py: 0.25 }}>Не удалось загрузить строки заявки. Повторите попытку.</Alert></TableCell></TableRow>}
    {modulesOnPage.map((module) => (
      <Fragment key={module.id}>
        <ModuleGroupHeaderRow module={module} level={level} columns={columns} widths={widths} user={user} view={view} />
        {(itemsByModule.get(module.module_id) || []).map((item) => (
          <RegistryRowCells
            key={item.id}
            item={item}
            columns={columns}
            widths={widths}
            selected={selectedIds.has(item.id)}
            active={activeId === item.id}
            user={user}
            approvalMode={approvalMode}
            structureLevel={level + 1}
            onSelect={(checked) => onToggleSelected(item, checked)}
            onActive={() => onActive(item)}
            onDecision={onDecision}
            onSaveRowDecision={onSaveRowDecision}
            onOpen={() => onOpen(item)}
            onHistory={() => onHistory(item)}
          />
        ))}
      </Fragment>
    ))}
    {(data || usesColumnFilteredItems) && !displayItems.length && <TableRow><TableCell colSpan={columnsCount} sx={{ pl: 5 }}><Typography variant="caption" color="text.secondary">Строк заявки не найдено.</Typography></TableCell></TableRow>}
    {!usesColumnFilteredItems && pagination && pagination.total_items > 0 && (
      <RegisterPaginationRow
        columnsCount={columnsCount}
        page={page}
        pageSize={pageSize}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
          sessionStorage.setItem(REQUEST_PAGE_SIZE_KEY, String(nextSize));
        }}
      />
    )}
  </>;
}

function TreeRows({
  headerOnly = false,
  groups,
  level,
  expanded,
  filters,
  columns,
  widths,
  selectedIds,
  selectedRows,
  selectedGroupIds,
  activeId,
  onToggle,
  onToggleSelected,
  onToggleGroupSelected,
  onActive,
  onDecision,
  onSaveRowDecision,
  onOpen,
  onHistory,
  onApproveGroup,
  onCfoReviewReject,
  onCfoReviewReturn,
  onCompleteCfoReview,
  onWorkflowApprove,
  onWorkflowDecision,
  onWorkflowReject,
  onWorkflowReturn,
  onWorkflowFix,
  onItems,
  requestId,
  user,
  approvalMode,
  view,
  visibleGroupIds,
  visibleItemIds,
  columnSort,
}: {
  headerOnly?: boolean;
  groups: ApprovalRegisterGroup[];
  level: number;
  expanded: Set<string>;
  filters: RegistryFilters;
  columns: typeof REGISTRY_COLUMNS;
  widths: Record<RegistryColumnId, number>;
  selectedIds: Set<string>;
  selectedRows: ApprovalRegisterRow[];
  selectedGroupIds: Set<string>;
  activeId: string | null;
  onToggle: (group: ApprovalRegisterGroup) => void;
  onToggleSelected: (item: ApprovalRegisterRow, checked: boolean) => void;
  onToggleGroupSelected: (group: ApprovalRegisterGroup, checked: boolean) => void;
  onActive: (item: ApprovalRegisterRow) => void;
  onDecision: (target: DecisionTarget) => void;
  onSaveRowDecision: (row: ApprovalRegisterRow, decision: RowDecision, amount: number, comment?: string) => void;
  onOpen: (item: ApprovalRegisterRow) => void;
  onHistory: (item: ApprovalRegisterRow) => void;
  onApproveGroup: (group: ApprovalRegisterGroup) => void;
  onCfoReviewReject: (group: ApprovalRegisterGroup) => void;
  onCfoReviewReturn: (group: ApprovalRegisterGroup) => void;
  onCompleteCfoReview: (group: ApprovalRegisterGroup) => void;
  onWorkflowApprove: (group: ApprovalRegisterGroup) => void;
  onWorkflowDecision: (group: ApprovalRegisterGroup) => void;
  onWorkflowReject: (group: ApprovalRegisterGroup) => void;
  onWorkflowReturn: (group: ApprovalRegisterGroup) => void;
  onWorkflowFix: (group: ApprovalRegisterGroup, unlock: boolean) => void;
  onItems: (groupId: string, items: ApprovalRegisterRow[]) => void;
  requestId?: string;
  user: User;
  approvalMode: boolean;
  view: RegistryView;
  visibleGroupIds: Set<string> | null;
  visibleItemIds: Set<string> | null;
  columnSort: TableSortState<RegistryColumnId> | null;
}) {
  const displayGroups = useMemo(
    () => sortRegisterGroups(filterRegisterGroups(groups, visibleGroupIds), columnSort),
    [columnSort, groups, visibleGroupIds],
  );

  const virtualRow = useContext(VirtualRowContext);
  return <>{displayGroups.map((group) => {
    const isExpanded = expanded.has(group.id);
    const hasContent = group.has_children || group.children.length > 0 || group.can_load_rows;
    const groupSelectable = isGroupSelectable(group, user.role);
    const descendants = collectDescendantGroups(group);
    const selectedChildGroup = descendants.some((entry) => entry.id !== group.id && selectedGroupIds.has(entry.id));
    const selectedChildRow = selectedRows.some((item) => groupMatchesRow(group, item));
    const groupChecked = selectedGroupIds.has(group.id);
    const groupIndeterminate = !groupChecked && (selectedChildGroup || selectedChildRow);
    const groupCells: Partial<Record<RegistryColumnId, React.ReactNode>> = {
      select: approvalMode && groupSelectable
        ? <Checkbox size="small" checked={groupChecked} indeterminate={groupIndeterminate} onChange={(_, checked) => onToggleGroupSelected(group, checked)} onClick={(event) => event.stopPropagation()} sx={{ p: 0.35 }} inputProps={{ 'aria-label': `Выбрать ${group.name}` }} />
        : null,
      structure: <Stack direction="row" alignItems="center" spacing={0.25} sx={{ pl: level * 1.15, minWidth: 0 }}><Box sx={{ width: 22, flex: '0 0 auto' }}>{hasContent && <IconButton size="small" aria-label={isExpanded ? 'Свернуть группу' : 'Раскрыть группу'} onClick={() => onToggle(group)} sx={{ p: 0.25 }}>{isExpanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}</IconButton>}</Box><Box minWidth={0}><Tooltip title={group.name || '—'}><Typography variant="body2" fontWeight={level === 0 ? 700 : 600} noWrap sx={{ fontSize: 13, lineHeight: 1.25 }}>{group.name}</Typography></Tooltip><Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1.2 }}>{group.label} · {groupRowsCaption(group)}{groupStructureCaptionExtras(group, user)}</Typography></Box></Stack>,
      requested: <GroupAggregateAmount group={group} field="requested_sum" />,
      approved: <GroupAggregateAmount group={group} field="approved_sum" />,
      rejected: <GroupAggregateAmount group={group} field="difference" />,
      your_step: null,
      status: (
        <Stack spacing={0.5} alignItems="flex-start">
          <RegistryGroupStatusCell status={groupRegistryStatus(group.aggregates)} aggregates={group.aggregates} />
          {approvalMode && (isGroupActionable(group, user.role) || (user.role === 'zgd' && (group.aggregates.fixed_rows || 0) === group.aggregates.total_rows)) && (
            <GroupActions
              group={group}
              user={user}
              onApproveCfo={onApproveGroup}
              onRejectCfo={onCfoReviewReject}
              onReturnCfo={onCfoReviewReturn}
              onCompleteCfoReview={onCompleteCfoReview}
              onWorkflowApprove={onWorkflowApprove}
              onWorkflowDecision={onWorkflowDecision}
              onWorkflowReject={onWorkflowReject}
              onWorkflowReturn={onWorkflowReturn}
              onWorkflowFix={onWorkflowFix}
            />
          )}
        </Stack>
      ),
      justification: '—',
      comment: '—',
      files: '—',
      actions: null,
      ...ANALYTICS_FIELD_KEYS.reduce((result, key) => {
        if (isAnalyticsGroup(group)) {
          result[key] = key === group.type ? group.name : '—';
        } else if ((group.type === 'article' || group.type === 'category') && group.analytics) {
          result[key] = (
            <GroupAnalyticsCell
              group={group}
              field={key}
              filters={filters}
              requestId={requestId}
            />
          );
        } else {
          result[key] = '—';
        }
        return result;
      }, {} as Partial<Record<RegistryColumnId, React.ReactNode>>),
    };
    return (
      <Fragment key={group.id}>
        <TableRow {...virtualRow} hover className="approval-register-row" sx={{ '& td': { py: 0.25, px: 0.75, height: 34, bgcolor: level === 0 ? '#f4f9ff' : '#fff', borderBottom: level === 0 ? '1px solid rgba(15, 23, 42, 0.08)' : undefined, fontSize: 13 }, '&:hover td': { bgcolor: '#edf6ff' } }}>
          {columns.map((column) => {
            const fixed = column.id === 'select' || column.id === 'structure';
            return (
              <TableCell
                key={column.id}
                align={['requested', 'approved', 'rejected', 'pending'].includes(column.id) ? 'right' : column.id === 'select' ? 'center' : 'left'}
                sx={{
                  width: widths[column.id],
                  minWidth: widths[column.id],
                  maxWidth: widths[column.id],
                  overflow: 'hidden',
                  position: fixed ? 'sticky' : 'static',
                  left: column.id === 'structure' ? widths.select : 0,
                  zIndex: fixed ? 2 : 0,
                  bgcolor: level === 0 ? '#f4f9ff !important' : '#fff !important',
                  borderRight: '1px solid',
                  borderColor: 'rgba(15, 23, 42, 0.06)',
                  fontWeight: ['requested', 'approved', 'rejected', 'pending'].includes(column.id) ? (level === 0 ? 700 : 500) : undefined,
                }}
              >
                {groupCells[column.id]}
              </TableCell>
            );
          })}
        </TableRow>
        {headerOnly ? null : isExpanded && group.type === 'category' && group.can_load_rows ? (
          <CategoryModuleRows
            category={group}
            modules={group.children}
            level={level + 1}
            expanded={isExpanded}
            filters={filters}
            columns={columns}
            widths={widths}
            selectedIds={selectedIds}
            activeId={activeId}
            user={user}
            approvalMode={approvalMode}
            view={view}
            onToggleSelected={onToggleSelected}
            onActive={onActive}
            onDecision={onDecision}
            onSaveRowDecision={onSaveRowDecision}
            onOpen={onOpen}
            onHistory={onHistory}
            onItems={onItems}
            requestId={requestId}
            visibleItemIds={visibleItemIds}
            columnSort={columnSort}
          />
        ) : (
          <>
            {isExpanded && group.children.length > 0 && (
              <TreeRows
                groups={group.children}
                level={level + 1}
                expanded={expanded}
                filters={filters}
                columns={columns}
                widths={widths}
                selectedIds={selectedIds}
                selectedRows={selectedRows}
                selectedGroupIds={selectedGroupIds}
                activeId={activeId}
                onToggle={onToggle}
                onToggleSelected={onToggleSelected}
                onToggleGroupSelected={onToggleGroupSelected}
                onActive={onActive}
                onDecision={onDecision}
                onSaveRowDecision={onSaveRowDecision}
                onOpen={onOpen}
                onHistory={onHistory}
                onApproveGroup={onApproveGroup}
                onCfoReviewReject={onCfoReviewReject}
                onCfoReviewReturn={onCfoReviewReturn}
                onCompleteCfoReview={onCompleteCfoReview}
                onWorkflowApprove={onWorkflowApprove}
                onWorkflowDecision={onWorkflowDecision}
                onWorkflowReject={onWorkflowReject}
                onWorkflowReturn={onWorkflowReturn}
                onWorkflowFix={onWorkflowFix}
                onItems={onItems}
                requestId={requestId}
                user={user}
                approvalMode={approvalMode}
                view={view}
                visibleGroupIds={visibleGroupIds}
                visibleItemIds={visibleItemIds}
                columnSort={columnSort}
              />
            )}
            {group.can_load_rows && group.type !== 'category' && (
              <RegisterRows
                group={group}
                expanded={isExpanded}
                filters={filters}
                columns={columns}
                widths={widths}
                selectedIds={selectedIds}
                activeId={activeId}
                user={user}
                approvalMode={approvalMode}
                onToggleSelected={onToggleSelected}
                onActive={onActive}
                onDecision={onDecision}
                onSaveRowDecision={onSaveRowDecision}
                onOpen={onOpen}
                onHistory={onHistory}
                onItems={onItems}
                requestId={requestId}
                visibleItemIds={visibleItemIds}
                columnSort={columnSort}
              />
            )}
          </>
        )}
      </Fragment>
    );
  })}</>;
}

type VirtualEntry = { key: string; group: ApprovalRegisterGroup; level: number; kind: 'group' | 'module' | 'item' | 'page'; item?: ApprovalRegisterRow; owner?: string };

function VirtualTreeRows(props: React.ComponentProps<typeof TreeRows> & { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const remoteQuery = useContext(RegisterQueryContext);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(sessionStorage.getItem(REQUEST_PAGE_SIZE_KEY));
    return [1, 10, 25, 50, 100, 200].includes(saved) ? saved : 50;
  });
  const [visibleOwners, setVisibleOwners] = useState<Set<string>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  useEffect(() => { setPages({}); }, [remoteQuery]);
  const leaves = useMemo(() => {
    const result: ApprovalRegisterGroup[] = [];
    const visit = (groups: ApprovalRegisterGroup[]) => groups.forEach((group) => {
      if (!props.expanded.has(group.id)) return;
      if (group.can_load_rows) result.push(group);
      if (!(group.type === 'category' && group.can_load_rows)) visit(group.children);
    });
    visit(props.groups);
    return result;
  }, [props.groups, props.expanded]);
  const results = useQueries({ queries: leaves.map((group) => ({
    queryKey: ['approval-register-rows', group.id, remoteQuery, pages[group.id] || 1, pageSize],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await api.post<ApprovalRegisterRowsResponse>('/approval-register/query', {
        ...remoteQuery, mode: 'rows', scope: group.scope || {}, page: pages[group.id] || 1, page_size: pageSize, include_aggregates: false,
      }, { signal });
      return { ...response.data, group: { ...response.data.group, aggregates: group.aggregates } };
    },
    enabled: visibleOwners.has(group.id),
  })) });
  const byGroup = new Map(leaves.map((group, index) => [group.id, results[index]]));
  const loadedSignature = results.map((result) => result.dataUpdatedAt).join(',');
  useEffect(() => {
    leaves.forEach((group, index) => {
      if (results[index].data) props.onItems(group.id, results[index].data!.items);
    });
  }, [loadedSignature, props.onItems]);
  const entries: VirtualEntry[] = [];
  const visit = (groups: ApprovalRegisterGroup[], level: number) => {
    for (const group of sortRegisterGroups(groups, props.columnSort)) {
      entries.push({ key: group.id, group, level, kind: 'group' });
      if (!props.expanded.has(group.id)) continue;
      if (!(group.type === 'category' && group.can_load_rows)) visit(group.children, level + 1);
      if (!group.can_load_rows) continue;
      const data = byGroup.get(group.id)?.data;
      if (data) {
        let moduleId = '';
        for (const item of data.items) {
          if (group.type === 'category' && moduleId !== item.module_id) {
            moduleId = item.module_id;
            const module = group.children.find((child) => child.module_id === moduleId);
            if (module) entries.push({ key: `${group.id}:module:${moduleId}:${item.id}`, group: module, level: level + 1, kind: 'module', owner: group.id });
          }
          entries.push({ key: `${group.id}:${item.id}`, group, level: level + 2, kind: 'item', item, owner: group.id });
        }
      } else {
        const count = Math.min(pageSize, group.aggregates.total_rows);
        for (let index = 0; index < count; index++) entries.push({ key: `${group.id}:pending:${index}`, group, level: level + 1, kind: 'item', owner: group.id });
      }
      entries.push({ key: `${group.id}:page`, group, level, kind: 'page', owner: group.id });
    }
  };
  visit(props.groups, props.level);
  const pinned = entries.findIndex((entry) => entry.key === focusedKey);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => props.scrollRef.current,
    estimateSize: (index) => entries[index].kind === 'item' ? 43 : 40,
    getItemKey: (index) => entries[index].key,
    overscan: 6,
    scrollMargin: props.scrollRef.current?.querySelector('thead')?.getBoundingClientRect().height || 0,
    rangeExtractor: (range) => [...new Set([...defaultRangeExtractor(range), ...(pinned >= 0 ? [pinned] : [])])].sort((a, b) => a - b),
  });
  const virtualItems = virtualizer.getVirtualItems();
  const owners = [...new Set(virtualItems.map((item) => entries[item.index].owner).filter(Boolean))] as string[];
  const ownersSignature = owners.join(',');
  useEffect(() => { setVisibleOwners(new Set(owners)); }, [ownersSignature]);
  const spacer = (height: number, key: string) => height > 0 ? <TableRow key={key} aria-hidden="true"><TableCell colSpan={props.columns.length} sx={{ height, p: 0, border: 0 }} /></TableRow> : null;
  let previousEnd = virtualizer.options.scrollMargin;
  return <>
    {virtualItems.map((virtual) => {
      const entry = entries[virtual.index];
      const gap = virtual.start - previousEnd;
      previousEnd = virtual.end;
      const result = byGroup.get(entry.owner || '');
      let content: ReactNode;
      if (entry.kind === 'group') content = <TreeRows {...props} groups={[entry.group]} level={entry.level} headerOnly />;
      else if (entry.kind === 'module') content = <ModuleGroupHeaderRow module={entry.group} level={entry.level} columns={props.columns} widths={props.widths} user={props.user} view={props.view} />;
      else if (entry.item) {
        const item = entry.item;
        content = <RegistryRowCells item={item} columns={props.columns} widths={props.widths} selected={props.selectedIds.has(item.id)} active={props.activeId === item.id} user={props.user} approvalMode={props.approvalMode} structureLevel={entry.group.type === 'category' ? entry.level : 0} onSelect={(checked) => props.onToggleSelected(item, checked)} onActive={() => props.onActive(item)} onDecision={props.onDecision} onSaveRowDecision={props.onSaveRowDecision} onOpen={() => props.onOpen(item)} onHistory={() => props.onHistory(item)} />;
      } else if (entry.kind === 'page' && result?.data) {
        content = <RegisterPaginationRow columnsCount={props.columns.length} page={result.data.pagination.page} pageSize={pageSize} pagination={result.data.pagination} onPageChange={(page) => { setPages((current) => ({ ...current, [entry.group.id]: page })); }} onPageSizeChange={(size) => { setPageSize(size); setPages({}); sessionStorage.setItem(REQUEST_PAGE_SIZE_KEY, String(size)); }} />;
      } else {
        content = <TableRow ref={virtualizer.measureElement} data-index={virtual.index}><TableCell colSpan={props.columns.length} sx={{ height: 43, py: 0 }}>{result?.error ? <Button onClick={() => result.refetch()}>Повторить загрузку строк</Button> : <Typography variant="caption" color="text.secondary">Загрузка строк…</Typography>}</TableCell></TableRow>;
      }
      return <Fragment key={entry.key}>
        {spacer(gap, 'gap')}
        <VirtualRowContext.Provider value={{ ref: virtualizer.measureElement, 'data-index': virtual.index, tabIndex: 0,
          onFocusCapture: () => setFocusedKey(entry.key),
          onKeyDown: (event) => {
            if (event.target !== event.currentTarget || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            const next = Math.max(0, Math.min(entries.length - 1, virtual.index + (event.key === 'ArrowDown' ? 1 : -1)));
            setFocusedKey(entries[next].key);
            virtualizer.scrollToIndex(next);
            requestAnimationFrame(() => props.scrollRef.current?.querySelector<HTMLElement>(`tr[data-index="${next}"]`)?.focus());
          },
        }}>{content}</VirtualRowContext.Provider>
      </Fragment>;
    })}
    {spacer(virtualizer.getTotalSize() + virtualizer.options.scrollMargin - previousEnd, 'end')}
  </>;
}

export function ApprovalRegister({
  user,
  requestId,
  embedded = false,
  inRequestsPage = false,
  hideHeader = false,
  flow,
  tableTabs,
}: {
  user: User;
  requestId?: string;
  embedded?: boolean;
  inRequestsPage?: boolean;
  hideHeader?: boolean;
  flow?: Exclude<RegistryFilters['flow'], ''>;
  tableTabs?: ReactNode;
}) {
  const toast = useAppToast();
  const availableViews = useMemo<RegistryView[]>(
    () => ['cfo', 'module', 'article', 'category', 'request'],
    [],
  );
  const defaultView = useMemo(() => defaultRegisterView(user), [user]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [storedPreferences] = useState(() => readPreferences(user.id, user.role));
  const initialView = (() => {
    const storedView = storedPreferences.view
      || (sessionStorage.getItem(registerViewStorageKey(user.id)) as RegistryView);
    return storedView && availableViews.includes(storedView) ? storedView : defaultView;
  })();
  const [view, setView] = useState<RegistryView>(initialView);
  const [groupBy, setGroupBy] = useState<RegisterGroupingLevel[]>(
    () => storedPreferences.groupBy || GROUPING_PRESETS[initialView],
  );
  const [filters, setFilters] = useState<RegistryFilters>(() => (
    flow ? { ...(storedPreferences.filters || EMPTY_FILTERS), flow } : (storedPreferences.filters || EMPTY_FILTERS)
  ));
  useEffect(() => {
    if (!flow) return;
    setFilters((current) => current.flow === flow ? current : { ...current, flow });
  }, [flow]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preferences, setPreferences] = useState(() => ({ order: storedPreferences.order, visibility: storedPreferences.visibility, widths: storedPreferences.widths }));
  const [draggedColumn, setDraggedColumn] = useState<RegistryColumnId | null>(null);
  const [loadedItems, setLoadedItems] = useState<Map<string, { item: ApprovalRegisterRow; groupId: string }>>(new Map());
  const [selected, setSelected] = useState<Map<string, ApprovalRegisterRow>>(new Map());
  const [selectedGroups, setSelectedGroups] = useState<Map<string, ApprovalRegisterGroup>>(new Map());
  const canUseApprovalMode = canUseRegisterApprovalMode(user.role);
  const [approvalMode, setApprovalMode] = useState(false);
  const [activeItem, setActiveItem] = useState<ApprovalRegisterRow | null>(null);
  const [detailsItem, setDetailsItem] = useState<ApprovalRegisterRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<RequestHistoryTarget | null>(null);
  const [registerHistoryOpen, setRegisterHistoryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettingsState>(() => defaultExportSettings(user, true));
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const openHistory = useCallback((item: ApprovalRegisterRow, full = false) => {
    setHistoryTarget({
      requestId: item.request_id,
      lineId: full ? undefined : item.id,
      lineName: full ? undefined : item.name,
      title: 'История изменений',
      subtitle: full
        ? `Заявка №${item.request_id.slice(0, 8)}`
        : `${item.name} · заявка №${item.request_id.slice(0, 8)}`,
    });
  }, []);
  const [decisionTarget, setDecisionTarget] = useState<DecisionTarget | null>(null);
  const [groupsToApprove, setGroupsToApprove] = useState<ApprovalRegisterGroup[]>([]);
  const [groupsToForward, setGroupsToForward] = useState<ApprovalRegisterGroup[]>([]);
  const [forwardLines, setForwardLines] = useState<ApprovalRegisterRow[]>([]);
  const [forwardLinesLoading, setForwardLinesLoading] = useState(false);
  const [revisionDialog, setRevisionDialog] = useState<{
    mode: 'cfo' | 'workflow';
    target?: RevisionTarget | null;
    initialLines?: ApprovalRegisterRow[];
  } | null>(null);
  const openPointRevision = useCallback((item: ApprovalRegisterRow) => {
    setRevisionDialog({
      mode: item.is_cfo_review_actionable || item.decision_editable_stage === 'cfo_review'
        ? 'cfo'
        : 'workflow',
      target: {
        groupType: 'article',
        groupId: item.article_id,
        groupName: item.article_name,
      },
      initialLines: [item],
    });
  }, []);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [deferredSearch, filters]);
  const queryClient = useQueryClient();
  useEffect(() => {
    const drill = registerDrillFromSearchParams(searchParams);
    if (!drill.cfoId && !drill.articleId && !drill.search && !drill.requestStatus && !drill.flow && !drill.frozen && !drill.positionedOnly && !drill.view) return;
    setFilters((current) => ({
      ...current,
      cfoId: drill.cfoId || '',
      articleId: drill.articleId || '',
      search: drill.search || current.search,
      requestStatus: drill.requestStatus || '',
      flow: drill.flow || '',
      frozen: drill.frozen || '',
      positionedOnly: drill.positionedOnly || false,
    }));
    if (drill.view && availableViews.includes(drill.view)) {
      setView(drill.view);
    } else if (drill.articleId) {
      setView(user.role === 'economist' ? 'cfo' : 'article');
    } else if (drill.cfoId) {
      setView('cfo');
    }
  }, [availableViews, searchParams, user.role]);
  useEffect(() => { sessionStorage.setItem(registerViewStorageKey(user.id), view); }, [user.id, view]);
  useEffect(() => {
    localStorage.setItem(
      preferencesStorageKey(user.id),
      JSON.stringify({ version: 2, view, groupBy, filters: filtersForPersistence(filters), ...preferences }),
    );
  }, [filters, groupBy, preferences, user.id, view]);
  useEffect(() => { setExpanded(new Set()); setSelected(new Map()); setSelectedGroups(new Map()); setLoadedItems(new Map()); }, [view, groupBy, filters.flow, filters.status, filters.budgetYear, filters.cfoId, filters.articleId, filters.requestStatus, filters.frozen, filters.positionedOnly, deferredSearch, ...ANALYTICS_FIELD_KEYS.map((key) => filters[key])]);
  const [facetsRequested, setFacetsRequested] = useState(false);
  const [remoteOptions, setRemoteOptions] = useState<Partial<Record<RegistryColumnId, TableFilterOption[]>>>({});
  const [coveredStatuses, setCoveredStatuses] = useState<Record<string, string[]>>({});
  const columnControls = useTableColumnControls({
    rows: EMPTY_REGISTER_CONTROLS,
    columns: REGISTRY_TABLE_COLUMN_DEFINITIONS,
    remoteOptions,
    adjustFilterSelection: ({ columnId, optionValue, nextValues }) => columnId === 'status' && !nextValues.includes(optionValue)
      ? nextValues.filter((value) => !(coveredStatuses[optionValue] || []).includes(value)) : undefined,
  });
  const serverColumns = useMemo(() => Object.fromEntries(Object.entries(columnControls.selectedFilterValues).filter(([, values]) => values?.length)), [columnControls.selectedFilterValues]);
  const registerQuery = useMemo(() => ({
    view, group_by: groupBy,
    filters: buildRegisterFilterParams(effectiveFilters, { request_id: requestId }),
    columns: serverColumns,
    sort: columnControls.sort,
  }), [view, groupBy, effectiveFilters, requestId, serverColumns, columnControls.sort]);
  const registerQueryKey = useMemo(() => ['approval-register', requestId, view, groupBy, effectiveFilters, serverColumns, columnControls.sort], [requestId, view, groupBy, effectiveFilters, serverColumns, columnControls.sort]);
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: registerQueryKey,
    queryFn: async ({ signal }) => (await api.post<ApprovalRegisterResponse>('/approval-register/query', { ...registerQuery, mode: 'summary', expanded: expanded.size ? [...expanded] : undefined }, { signal })).data,
  });
  const { data: facets } = useQuery({
    queryKey: ['approval-register', 'facets', registerQuery],
    queryFn: async ({ signal }) => (await api.post<{ options: Partial<Record<RegistryColumnId, TableFilterOption[]>>; covered_statuses?: Record<string, string[]> }>('/approval-register/query', { ...registerQuery, mode: 'facets' }, { signal })).data,
    enabled: facetsRequested,
  });
  useEffect(() => {
    if (facets) {
      setRemoteOptions(facets.options);
      setCoveredStatuses(facets.covered_statuses || {});
    }
  }, [facets]);
  const initializedExpansion = useRef('');
  useEffect(() => {
    if (!data?.groups?.length) return;
    const identity = JSON.stringify(registerQuery);
    if (initializedExpansion.current === identity) return;
    initializedExpansion.current = identity;
    setExpanded((current) => (
      current.size > 0 ? current : new Set(collectDefaultExpandedGroupIds(data.groups, view))
    ));
  }, [data?.groups, view, groupBy, filters.flow, filters.status, filters.budgetYear, filters.cfoId, filters.articleId, filters.requestStatus, filters.frozen, filters.positionedOnly, deferredSearch, ...ANALYTICS_FIELD_KEYS.map((key) => filters[key])]);
  useEffect(() => {
    if (!data?.groups?.length || !filters.articleId) return;
    const matches: ApprovalRegisterGroup[] = [];
    const visit = (nodes: ApprovalRegisterGroup[]) => {
      nodes.forEach((group) => {
        if (group.type === 'article' && group.article_id === filters.articleId) matches.push(group);
        visit(group.children);
      });
    };
    visit(data.groups);
    if (!matches.length) return;
    setExpanded((current) => {
      const next = new Set(current);
      matches.forEach((group) => collectExpandableGroupIds(group).forEach((id) => next.add(id)));
      return next;
    });
  }, [data?.groups, filters.articleId]);
  const { data: analyticsFilterOptions = {} } = useQuery({
    queryKey: ['approval-register-analytics-filters', requestId, effectiveFilters],
    queryFn: async ({ signal }) => (await api.get<Partial<Record<AnalyticsFieldKey, string[]>>>('/approval-register/analytics-filters', {
      params: buildRegisterFilterParams(effectiveFilters, { request_id: requestId }),
      signal,
    })).data,
  });
  const drillLabels = useMemo(
    () => (data?.groups?.length ? resolveRegisterDrillLabels(data.groups, filters) : {}),
    [data?.groups, filters.cfoId, filters.articleId],
  );
  const drillTitle = useMemo(
    () => registerDrillTitle(filters, drillLabels),
    [drillLabels, filters.cfoId, filters.articleId, filters.requestStatus],
  );
  const refreshAfterRevision = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['approval-register'] });
    queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
    queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
    queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
    queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
    setSelected(new Map());
    setSelectedGroups(new Map());
  }, [queryClient]);
  const openGroupRevision = async (groups: ApprovalRegisterGroup[], mode: 'cfo' | 'workflow') => {
    const parents = buildParentMap(data?.groups || []);
    const roots = topLevelSelectedGroups(groups, parents);
    if (roots.length === 0) return;
    if (roots.length === 1) {
      setRevisionDialog({ mode, target: revisionTargetFromGroup(roots[0]) });
      return;
    }
    try {
      const loaded = (await Promise.all(roots.map((group) => loadGroupRevisionLines(group, mode)))).flat();
      const lines = [...new Map(loaded.map((line) => [line.id, line])).values()];
      if (!lines.length) {
        toast('В выбранных группах нет строк, доступных для отправки на доработку', 'info');
        return;
      }
      setRevisionDialog({ mode, initialLines: lines });
    } catch (error) {
      toast(getApiErrorMessage(error, 'Не удалось загрузить строки для отправки на доработку'), 'error');
    }
  };
  const decide = useMutation({ mutationFn: async ({ target, comment, amount }: { target: DecisionTarget; comment: string; amount?: number }) => {
    if (target.rows.length > 1) {
      return postBulkRowDecision(target.rows, target.decision, comment);
    }
    return postRowDecision(target.rows[0], target.decision, comment, amount);
  }, onSuccess: (response, variables) => {
    if (variables.target.rows.length === 1 && !variables.target.rows[0].is_final_approval_actionable) {
      updateRegisterCache(queryClient, variables.target.rows[0], (response as { data: BudgetItem }).data);
      // Actionability ("your action", current owner and revision state) is
      // calculated from workflow logs by the register endpoint.  The item
      // response only contains the changed row, so refreshing just the local
      // row leaves the previous action hint visible until a full reload.
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
    }
    setSelected(new Map()); setSelectedGroups(new Map()); setDecisionTarget(null);
  }, onError: (error) => toast(getApiErrorMessage(error, 'Не удалось сохранить решение'), 'error') });
  const saveRowDecision = useMutation({
    mutationFn: async ({ row, decision, amount, comment = '' }: { row: ApprovalRegisterRow; decision: RowDecision; amount?: number; comment?: string }) => (
      postRowDecision(row, decision, comment, amount)
    ),
    onSuccess: (response, variables) => {
      if (!variables.row.is_final_approval_actionable) {
        updateRegisterCache(queryClient, variables.row, response.data as BudgetItem);
      }
      // The register's actionability and revision state are derived from
      // workflow logs, so a plain item response is not enough to refresh them.
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      setSelected(new Map());
      setSelectedGroups(new Map());
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось сохранить решение по строке'), 'error'),
  });
  const markRowForRevision = useMutation({
    mutationFn: async (row: ApprovalRegisterRow) => (
      api.post<BudgetItem>(`/items/${row.id}/cfo-revision-selection`, { comment: row.comment || '' })
    ),
    onSuccess: (response, row) => {
      updateRegisterCache(queryClient, row, response.data);
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      toast('Строка отмечена на доработку. Отправьте выбранные строки из окна «На доработку».', 'success');
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось отметить строку на доработку'), 'error'),
  });
  const markPointRevision = useCallback((row: ApprovalRegisterRow) => {
    markRowForRevision.mutate(row);
  }, [markRowForRevision]);
  const handleSaveRowDecision = useCallback((
    row: ApprovalRegisterRow,
    decision: RowDecision,
    amount?: number,
    comment = '',
  ) => {
    saveRowDecision.mutate({ row, decision, amount, comment });
  }, [saveRowDecision]);
  const approveGroups = useMutation({
    mutationFn: async (groups: ApprovalRegisterGroup[]) => {
      for (const group of groups) {
        await api.post(
          `/approval-register/groups/${group.type}/${groupEntityId(group)}/cfo-decision`,
          { decision: 'approved', comment: '', register_query: { ...registerQuery, scope: group.scope || {} } },
          { params: { request_id: requestId } },
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      setGroupsToApprove([]);
      setSelected(new Map());
      setSelectedGroups(new Map());
    },
    onError: (error) => {
      // A decision may have been saved before a later request in the same
      // bulk action fails. Refreshing prevents the stale selection from
      // offering an already completed CFO review again.
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      setGroupsToApprove([]);
      setSelected(new Map());
      setSelectedGroups(new Map());
      toast(getApiErrorMessage(error, 'Не удалось согласовать группу'), 'error');
    },
  });
  const completeCfoReviewGroups = useMutation({
    mutationFn: async (groups: ApprovalRegisterGroup[]) => {
      const requestIds = [...new Set(groups.flatMap((group) => group.request_ids))];
      for (const id of requestIds) {
        await api.post(`/requests/${id}/complete-cfo-review`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-incoming-requests'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      setSelected(new Map());
      setSelectedGroups(new Map());
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось завершить проверку ЦФО'), 'error'),
  });
  const workflowGroupAction = useMutation({
    mutationFn: async ({ groups, action, comment = '', targetStepId }: { groups: ApprovalRegisterGroup[]; action: 'submit' | 'approve' | 'return_for_revision' | 'fix' | 'unfix'; comment?: string; targetStepId?: string }) => {
      for (const group of groups) {
        await api.post(
          `/approval-register/groups/${group.type}/${groupEntityId(group)}/workflow-action`,
          { action, comment, register_query: { ...registerQuery, scope: group.scope || {} }, ...(targetStepId ? { target_step_id: targetStepId } : {}) },
          { params: { request_id: requestId } },
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      setSelected(new Map());
      setSelectedGroups(new Map());
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось выполнить действие по группе'), 'error'),
  });
  const forwardApprovalGroups = useMutation({
    mutationFn: async (groups: ApprovalRegisterGroup[]) => {
      if (user.role === 'employee') {
        const groupsAwaitingCompletion = groups.filter(groupHasCfoCompleteActions);
        const requestIds = [...new Set(groupsAwaitingCompletion.flatMap((group) => group.request_ids))];
        const revisionRequests = new Set<string>();
        for (const id of requestIds) {
          try {
            const result = await api.post<{ revision_item_ids?: string[] }>(`/requests/${id}/complete-cfo-review`);
            if (result.data.revision_item_ids?.length) revisionRequests.add(id);
          } catch (error) {
            // A previous attempt can complete the review and then be stopped
            // by a later route check. Continue with the actual forward action
            // instead of trying to complete an already completed review again.
            if (!getApiErrorMessage(error, '').includes('Проверка ЦФО уже завершена')) throw error;
          }
        }
        // Completing the CFO review only prepares positions for the route.
        // The same explicit «Отправить дальше» action must also move those
        // positions to the economist; otherwise the register keeps showing
        // «Передайте экономисту» after a seemingly successful handoff.
        for (const group of groups) {
          if (group.request_ids.some((id) => revisionRequests.has(id))) continue;
          await api.post(
            `/approval-register/groups/${group.type}/${groupEntityId(group)}/workflow-action`,
            { action: 'submit', comment: '', register_query: { ...registerQuery, scope: group.scope || {} } },
            { params: { request_id: requestId } },
          );
        }
        return;
      }
      for (const group of groups) {
        await api.post(
          `/approval-register/groups/${group.type}/${groupEntityId(group)}/workflow-action`,
          { action: 'approve', comment: '', register_query: { ...registerQuery, scope: group.scope || {} } },
          { params: { request_id: requestId } },
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      setGroupsToForward([]);
      setForwardLines([]);
      clearSelection();
      toast('Данные переданы на следующий этап', 'success');
    },
    onError: (error) => {
      // The first part of forwarding may have completed successfully. Do not
      // leave controls based on the pre-action group snapshot on screen.
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-route'] });
      setGroupsToForward([]);
      setForwardLines([]);
      setSelected(new Map());
      setSelectedGroups(new Map());
      toast(getApiErrorMessage(error, 'Не удалось передать данные дальше'), 'error');
    },
  });
  const loadBranch = useCallback(async (group: ApprovalRegisterGroup): Promise<ApprovalRegisterGroup> => {
    if (!group.has_children || group.children.length) return group;
    const response = await queryClient.fetchQuery({
      queryKey: ['approval-register', 'branch', registerQuery, group.id],
      queryFn: async ({ signal }) => (await api.post<ApprovalRegisterResponse>('/approval-register/query', { ...registerQuery, mode: 'groups', scope: group.scope || {} }, { signal })).data,
    });
    const loaded = { ...group, children: response.groups };
    queryClient.setQueryData<ApprovalRegisterResponse>(registerQueryKey, (current) => {
      if (!current) return current;
      const merge = (groups: ApprovalRegisterGroup[]): ApprovalRegisterGroup[] => groups.map((entry) => entry.id === group.id ? loaded : { ...entry, children: merge(entry.children) });
      return { ...current, groups: merge(current.groups) };
    });
    return loaded;
  }, [queryClient, registerQuery, registerQueryKey]);
  const toggleGroup = useCallback(async (group: ApprovalRegisterGroup) => {
    if (expanded.has(group.id)) {
      setExpanded((current) => { const next = new Set(current); collectExpandableGroupIds(group).forEach((id) => next.delete(id)); return next; });
      return;
    }
    try {
      const pending = [group];
      const ids: string[] = [];
      while (pending.length) {
        const branch = await loadBranch(pending.shift()!);
        if (branch.has_children || branch.children.length || branch.can_load_rows) ids.push(branch.id);
        pending.push(...branch.children);
      }
      setExpanded((current) => new Set([...current, ...ids]));
    } catch (error) { toast(getApiErrorMessage(error, 'Не удалось загрузить группу'), 'error'); }
  }, [expanded, loadBranch, toast]);
  const expandAll = useCallback(async () => {
    for (const group of data?.groups || []) {
      if (!expanded.has(group.id)) await toggleGroup(group);
      else {
        for (const child of group.children) if (!expanded.has(child.id)) await toggleGroup(child);
      }
    }
  }, [data?.groups, expanded, toggleGroup]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);
  const pageChromeActions = useMemo(() => (
    <Stack direction="row" spacing={0.25} flexWrap="wrap" useFlexGap className="approval-register-chrome-actions">
      <Button size="small" color="inherit" startIcon={<UnfoldLessIcon sx={{ fontSize: 16 }} />} onClick={collapseAll} sx={{ textTransform: 'none', fontWeight: 500, minWidth: 0, px: 0.75, fontSize: 13 }}>
        Свернуть все
      </Button>
      <Button size="small" color="inherit" startIcon={<UnfoldMoreIcon sx={{ fontSize: 16 }} />} onClick={expandAll} sx={{ textTransform: 'none', fontWeight: 500, minWidth: 0, px: 0.75, fontSize: 13 }}>
        Развернуть все
      </Button>
    </Stack>
  ), [collapseAll, expandAll]);
  const toggleColumn = (id: RegistryColumnId) => setPreferences((current) => ({
    ...current,
    visibility: applyWorkflowColumnVisibility(
      { ...current.visibility, [id]: !current.visibility[id] },
      user.role,
    ),
  }));
  const moveColumn = (target: RegistryColumnId) => {
    if (!draggedColumn || draggedColumn === target || target === 'select' || target === 'structure') return;
    setPreferences((current) => {
      const order = current.order.filter((id) => id !== draggedColumn);
      const targetIndex = order.indexOf(target);
      if (targetIndex < 0) return current;
      order.splice(targetIndex, 0, draggedColumn);
      return { ...current, order };
    });
    setDraggedColumn(null);
  };
  const resizeColumn = (id: RegistryColumnId, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = preferences.widths[id];
    const onMove = (moveEvent: PointerEvent) => setPreferences((current) => ({
      ...current,
      widths: {
        ...current.widths,
        [id]: Math.max(REGISTRY_COLUMN_MIN_WIDTHS[id], startWidth + moveEvent.clientX - startX),
      },
    }));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const controlRows = useMemo(
    () => buildRegisterControlRows(
      data?.groups || [],
      ([...loadedItems.values()].map(({ item }) => item)).map((item) => ({
        item,
        groupId: '',
      })),
    ),
    [data?.groups, loadedItems],
  );
  const visibleGroupIds: Set<string> | null = null;
  const visibleItemIds: Set<string> | null = null;
  const filteredExportItemIds = data?.matched_item_ids ?? null;
  const summaryAggregates = data?.aggregates ?? null;
  const analyticsSummary = data?.analytics_summary || [];
  const displayRegisterGroups = data?.groups || [];
  const filteredItemsByGroup = null;
  const autoFitColumn = (id: RegistryColumnId) => {
    const values = getRegisterAutoFitValues(controlRows, id);
    const label = REGISTRY_COLUMNS.find((column) => column.id === id)?.label || '';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '14px Roboto, Arial, sans-serif';
    const widest = Math.max(
      context.measureText(label).width,
      ...values.map((value) => context.measureText(value).width),
      0,
    );
    setPreferences((current) => ({
      ...current,
      widths: {
        ...current.widths,
        [id]: Math.min(420, Math.max(REGISTRY_COLUMN_MIN_WIDTHS[id], Math.ceil(widest + 56))),
      },
    }));
  };
  const visibleColumns = orderedRegistryColumns(preferences.order, preferences.visibility)
    .filter((column) => approvalMode || column.id !== 'select');
  const effectiveWidths = useMemo(
    () => ({
      ...preferences.widths,
      status: Math.max(preferences.widths.status, REGISTRY_COLUMN_MIN_WIDTHS.status),
      select: approvalMode ? preferences.widths.select : 0,
    }),
    [approvalMode, preferences.widths],
  );
  const tableWidth = visibleColumns.reduce((total, column) => total + effectiveWidths[column.id], 0);
  const selectedRows = [...selected.values()];
  const selectedGroupList = [...selectedGroups.values()];
  const groupParents = useMemo(() => buildParentMap(data?.groups || []), [data?.groups]);
  const selectionRoots = useMemo(
    () => topLevelSelectedGroups(selectedGroupList, groupParents),
    [selectedGroupList, groupParents],
  );
  const hasSelection = selectedRows.length > 0 || selectedGroupList.length > 0;
  const allApprovalRoots = useMemo(
    () => displayRegisterGroups.filter((group) => isGroupSelectable(group, user.role)),
    [displayRegisterGroups, user.role],
  );
  const allApprovalRootsSelected = allApprovalRoots.length > 0
    && allApprovalRoots.every((group) => selectedGroups.has(group.id));
  const scopeSelection = useCallback(async (group: ApprovalRegisterGroup) => new Set(
    (await api.post<{ item_ids: string[] }>('/approval-register/query', { ...registerQuery, mode: 'selection', scope: group.scope || {} })).data.item_ids,
  ), [registerQuery]);
  const loadGroupActionableRows = useCallback(async (group: ApprovalRegisterGroup) => {
    const [selection, response] = await Promise.all([
      scopeSelection(group),
      api.get<{ lines: ApprovalRegisterRow[] }>(`/approval-register/groups/${group.type}/${groupEntityId(group)}/actionable-rows`, {
        params: buildRegisterFilterParams(effectiveFilters, { request_id: requestId }),
      }),
    ]);
    return response.data.lines.filter((row) => selection.has(row.id));
  }, [effectiveFilters, requestId, scopeSelection]);
  const loadGroupRevisionLines = useCallback(async (group: ApprovalRegisterGroup, mode: 'cfo' | 'workflow') => {
    const [selection, response] = await Promise.all([
      scopeSelection(group),
      api.get<{ lines: ApprovalRegisterRow[] }>(`/approval-register/groups/${group.type}/${groupEntityId(group)}/revision-lines`, { params: { mode, request_id: requestId } }),
    ]);
    return response.data.lines.filter((row) => selection.has(row.id));
  }, [requestId, scopeSelection]);
  const openForwardDialog = useCallback(async (groups: ApprovalRegisterGroup[]) => {
    if (!groups.length) return;
    setGroupsToForward(groups);
    setForwardLines([]);
    setForwardLinesLoading(true);
    try {
      const loaded = (await Promise.all(groups.map(async (group) => {
        const actionable = await loadGroupActionableRows(group);
        if (actionable.length) return actionable;
        return loadGroupRevisionLines(group, user.role === 'employee' ? 'cfo' : 'workflow');
      }))).flat();
      setForwardLines([...new Map(loaded.map((line) => [line.id, line])).values()]);
    } catch (error) {
      setGroupsToForward([]);
      toast(getApiErrorMessage(error, 'Не удалось загрузить детализацию строк'), 'error');
    } finally {
      setForwardLinesLoading(false);
    }
  }, [loadGroupActionableRows, loadGroupRevisionLines, toast, user.role]);
  const openWorkflowGroupDecision = useCallback(async (group: ApprovalRegisterGroup) => {
    try {
      const loaded = await loadGroupActionableRows(group);
      const rows = [...new Map(loaded.map((row) => [row.id, row])).values()]
        .filter((row) => isRowActionable(row, user.role));
      if (!rows.length) {
        toast('В выбранной группе нет строк, доступных для решения', 'info');
        return;
      }
      setDecisionTarget({ rows, decision: 'approved' });
    } catch (error) {
      toast(getApiErrorMessage(error, 'Не удалось загрузить строки группы'), 'error');
    }
  }, [loadGroupActionableRows, toast, user.role]);
  const openGroupReject = useCallback(async (groups: ApprovalRegisterGroup[]) => {
    try {
      const loaded = (await Promise.all(groups.map(loadGroupActionableRows))).flat();
      const rows = [...new Map(loaded.map((row) => [row.id, row])).values()].filter((row) => (
        user.role === 'employee'
          ? row.is_cfo_review_actionable || row.decision_editable_stage === 'cfo_review'
          : row.is_approval_actionable || row.decision_editable_stage === 'economist'
      ));
      if (!rows.length) {
        toast('В выбранной группе нет строк, доступных для отклонения', 'info');
        return;
      }
      setDecisionTarget({ rows, decision: 'rejected' });
    } catch (error) {
      toast(getApiErrorMessage(error, 'Не удалось загрузить строки группы'), 'error');
    }
  }, [loadGroupActionableRows, toast, user.role]);
  const clearSelection = () => {
    setSelected(new Map());
    setSelectedGroups(new Map());
  };
  const handleBulkApprove = () => {
    const actionableRows = selectedRows.filter((row) => isRowActionable(row, user.role));
    if (selectionRoots.length > 0) {
      const cfoRoots = cfoGroupsForApproval(selectionRoots);
      const workflowRoots = workflowGroupsForApprove(selectionRoots);
      if (cfoRoots.length) setGroupsToApprove(cfoRoots);
      else if (workflowRoots.length) workflowGroupAction.mutate({ groups: workflowRoots, action: 'approve' });
      else if (actionableRows.length) setDecisionTarget({ rows: actionableRows, decision: 'approved' });
      return;
    }
    if (actionableRows.length === 1) {
      const row = actionableRows[0];
      setDecisionTarget({
        rows: [row],
        decision: 'approved',
        amount: row.approved_sum || row.requested_sum,
        allowAmountEdit: (user.role === 'economist' && (row.is_approval_actionable || row.decision_editable_stage === 'economist'))
          || (user.role === 'employee' && (row.is_cfo_review_actionable || row.decision_editable_stage === 'cfo_review')),
        allowDecisionChoice: user.role === 'employee' && (row.is_cfo_review_actionable || row.decision_editable_stage === 'cfo_review'),
      });
      return;
    }
    if (actionableRows.length > 1) {
      setDecisionTarget({ rows: actionableRows, decision: 'approved' });
    }
  };
  const handleBulkReject = () => {
    const actionableRows = selectedRows.filter((row) => isRowActionable(row, user.role));
    if (selectionRoots.length > 0) {
      const cfoRoots = cfoGroupsForReturn(selectionRoots);
      const workflowRoots = workflowGroupsForAction(selectionRoots)
        .filter((group) => user.role === 'employee' || groupHasWorkflowReturn(group, user.role));
      if (cfoRoots.length) openGroupRevision(cfoRoots, 'cfo');
      else if (workflowRoots.length) openGroupRevision(workflowRoots, 'workflow');
      return;
    }
    if (['approver', 'zgd'].includes(user.role) && actionableRows.some((row) => row.is_final_approval_actionable)) {
      const workflowRows = actionableRows.filter((row) => row.is_final_approval_actionable);
      if (workflowRows.every((row) => row.is_workflow_submission_actionable)) {
        setRevisionDialog({ mode: 'workflow', initialLines: workflowRows });
      } else {
        toast('Для возврата на доработку выберите группировку, а не отдельные строки', 'info');
      }
      return;
    }
    if (['approver', 'zgd'].includes(user.role) && actionableRows.length) {
      toast('Для возврата на доработку выберите группировку, а не отдельные строки.', 'info');
      return;
    }
    if (actionableRows.length === 1 && user.role === 'employee') {
      openPointRevision(actionableRows[0]);
      return;
    }
    if (actionableRows.length === 1 && user.role === 'economist') {
      setDecisionTarget({ rows: actionableRows, decision: 'on_revision' });
      return;
    }
    if (actionableRows.length === 1) {
      setDecisionTarget({ rows: actionableRows, decision: 'rejected' });
      return;
    }
    if (actionableRows.length > 0 && user.role === 'employee') {
      const first = actionableRows[0];
      const sameArticle = actionableRows.every((row) => row.article_id === first.article_id);
      setRevisionDialog({
        mode: 'cfo',
        target: sameArticle
          ? { groupType: 'article', groupId: first.article_id, groupName: first.article_name }
          : undefined,
        initialLines: actionableRows,
      });
      return;
    }
    if (actionableRows.length > 0) {
      setDecisionTarget({
        rows: actionableRows,
        decision: user.role === 'economist' ? 'on_revision' : 'rejected',
      });
    }
  };
  const toggleRowSelected = (item: ApprovalRegisterRow, checked: boolean) => {
    if (checked) setSelectedGroups(new Map());
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  };
  const toggleGroupSelected = async (group: ApprovalRegisterGroup, checked: boolean) => {
    const descendants = collectDescendantGroups(group);
    setSelectedGroups((current) => {
      const next = new Map(current);
      descendants.forEach((entry) => {
        if (checked && isGroupSelectable(entry, user.role)) next.set(entry.id, entry);
        else next.delete(entry.id);
      });
      return next;
    });
    if (checked) {
      setExpanded((current) => {
        const next = new Set(current);
        descendants.forEach((entry) => {
          if (entry.children.length || entry.can_load_rows) next.add(entry.id);
        });
        return next;
      });
      try {
        const lines = await loadGroupActionableRows(group);
        setSelected((current) => {
          const next = new Map(current);
          lines.forEach((item) => next.set(item.id, item));
          return next;
        });
      } catch {
        // selection stays on groups even if row preload fails
      }
      return;
    }
    try {
      const lines = await loadGroupActionableRows(group);
      setSelected((current) => {
        const next = new Map(current);
        lines.forEach((item) => next.delete(item.id));
        return next;
      });
    } catch {
      setSelected(new Map());
    }
  };
  const toggleAllSelected = async (checked: boolean) => {
    if (!checked) {
      clearSelection();
      return;
    }
    const groups = allApprovalRoots;
    const groupMap = new Map<string, ApprovalRegisterGroup>();
    groups.flatMap(collectDescendantGroups).forEach((group) => {
      if (isGroupSelectable(group, user.role)) groupMap.set(group.id, group);
    });
    setSelectedGroups(groupMap);
    try {
      const rows = (await Promise.all(groups.map(loadGroupActionableRows))).flat();
      setSelected(new Map(rows.map((row) => [row.id, row])));
    } catch (error) {
      setSelectedGroups(new Map());
      setSelected(new Map());
      toast(getApiErrorMessage(error, 'Не удалось выбрать все доступные строки'), 'error');
    }
  };
  const cfoGroupsForApproval = (groups: ApprovalRegisterGroup[]) => groups.filter(
    (group) => group.aggregates.cfo_review_actionable_requests > 0,
  );
  const cfoGroupsForReturn = (groups: ApprovalRegisterGroup[]) => (
    user.role === 'employee' ? groups.filter((group) => (
      groupHasCfoDecisionActions(group, user.role)
      || selectedRows.some((row) => {
        const fieldByType: Record<string, keyof ApprovalRegisterRow> = {
          cfo: 'cfo_id',
          article: 'article_id',
          category: 'category_id',
          module: 'module_id',
          request: 'request_id',
        };
        const field = fieldByType[group.type];
        return field ? row[field] === groupEntityId(group) : false;
      })
    )) : []
  );
  const workflowGroupsForAction = (groups: ApprovalRegisterGroup[]) => (
    groups.filter((group) => groupHasWorkflowApprove(group, user.role))
  );
  const workflowGroupsForApprove = (groups: ApprovalRegisterGroup[]) => (
    groups.filter((group) => groupHasWorkflowApprove(group, user.role))
  );
  const exportRegister = useCallback(async () => {
    setExporting(true);
    try {
      const hasUnitScope = exportSettings.department_ids.length > 0 || exportSettings.module_ids.length > 0;
      const filters = buildRegisterFilterParams(
        { ...effectiveFilters, requestStatus: '', cfoId: hasUnitScope ? '' : effectiveFilters.cfoId },
        { request_id: requestId, request_status: exportSettings.statuses.join(',') || undefined },
      );
      const response = await api.post('/approval-register/export', {
        query: { ...registerQuery, filters },
        include_files: exportSettings.include_files,
        export_kind: exportSettings.export_kind,
        fixed_only: exportSettings.fixed_only,
        department_ids: exportSettings.department_ids,
        module_ids: exportSettings.module_ids,
      }, { responseType: 'blob' });
      const contentType = String(response.headers['content-type'] || '');
      const disposition = String(response.headers['content-disposition'] || '');
      const isZip = contentType.includes('zip') || disposition.toLowerCase().includes('.zip');
      const baseName = hideHeader ? 'Табличный_вид' : 'Реестр_заявок';
      downloadBlob(response.data, `${baseName}.${isZip ? 'zip' : 'xlsx'}`);
      setExportOpen(false);
    } catch (error) {
      toast(await getDownloadApiErrorMessage(error, 'Не удалось выгрузить Excel'), 'error');
    } finally {
      setExporting(false);
    }
  }, [
    effectiveFilters,
    registerQuery,
    exportSettings,
    filteredExportItemIds,
    groupBy,
    hideHeader,
    requestId,
    toast,
    view,
    visibleItemIds,
  ]);
  const openExportSettings = useCallback(() => {
    setExportSettings(exportSettingsFromRegister({
      user,
      flow: effectiveFilters.flow,
      requestStatus: effectiveFilters.requestStatus,
      cfoId: effectiveFilters.cfoId,
      visibleRequestStatuses: data?.visible_request_statuses || [],
      visibleUnitIds: data?.visible_unit_ids || [],
      units,
    }));
    setExportOpen(true);
  }, [data?.visible_request_statuses, data?.visible_unit_ids, effectiveFilters.cfoId, effectiveFilters.requestStatus, units, user]);
  const registerGroupItems = useCallback((groupId: string, items: ApprovalRegisterRow[]) => {
    setLoadedItems((current) => {
      const next = new Map(current);
      items.forEach((item) => next.set(item.id, { item, groupId }));
      return next;
    });
    setSelected((current) => {
      let changed = false;
      const next = new Map(current);
      const shouldAutoSelect = selectedGroups.has(groupId);
      items.forEach((item) => {
        if (shouldAutoSelect && isRowActionable(item, user.role) && !next.has(item.id)) {
          next.set(item.id, item);
          changed = true;
        } else if (next.has(item.id) && next.get(item.id) !== item) {
          next.set(item.id, item);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [selectedGroups, user.role]);
  const hasActiveTableFilters = Boolean(
    filters.search
    || filters.flow
    || filters.status
    || filters.budgetYear
    || filters.cfoId
    || filters.articleId
    || filters.requestStatus
    || filters.frozen
    || ANALYTICS_FIELD_KEYS.some((key) => filters[key])
    || columnControls.hasActiveFilters,
  );
  const resetRegisterFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    columnControls.resetFilters();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['register_view', 'cfo_id', 'article_id', 'request_status', 'flow', 'frozen', 'search'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [columnControls, setSearchParams]);
  usePageChromeLeading(useMemo(() => {
    if (embedded || tableTabs) return null;
    if (hideHeader) {
      return <Typography component="h1" className="page-title">Табличный вид</Typography>;
    }
    if (inRequestsPage) {
      return (
        <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
          <Typography component="h1" className="page-title">Заявки</Typography>
          <Chip
            label={approvalMode ? 'Режим согласования' : 'Режим просмотра'}
            size="small"
            color={approvalMode ? 'primary' : 'default'}
            sx={{ height: 24, fontSize: 12, fontWeight: 600, bgcolor: approvalMode ? undefined : '#EEF4FF' }}
          />
        </Stack>
      );
    }
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: 12 }}>
        register &gt; Реестр бюджетных заявок
      </Typography>
    );
  }, [approvalMode, embedded, hideHeader, inRequestsPage, tableTabs]));
  const columnTools = (
    <TableColumnTools
      buttonLabel="Колонки"
      columns={REGISTRY_COLUMNS}
      visibility={preferences.visibility}
      onToggleColumn={toggleColumn}
      onResetColumns={() => setPreferences({ order: DEFAULT_COLUMN_ORDER, visibility: defaultRegistryColumnVisibility(user.role), widths: DEFAULT_COLUMN_WIDTHS })}
      onResetFilters={() => {
        setFilters(EMPTY_FILTERS);
        columnControls.resetFilters();
      }}
      onResetWidths={() => setPreferences((current) => ({ ...current, widths: DEFAULT_COLUMN_WIDTHS }))}
      hasActiveFilters={hasActiveTableFilters}
    />
  );
  const setApprovalModeEnabled = (enabled: boolean) => {
    setApprovalMode(enabled);
    clearSelection();
    setDecisionTarget(null);
  };
  const saveCurrentFilter = () => {
    localStorage.setItem(`budgetbasket:approval-register:saved-filter:${user.id}`, JSON.stringify(filtersForPersistence(filters)));
    toast('Текущие фильтры сохранены', 'success');
  };
  const tableHeroActions = useMemo(() => {
    if (!tableTabs) return null;
    return (
      <Stack
        direction="row"
        spacing={0.5}
        flexWrap="wrap"
        useFlexGap
        justifyContent="flex-end"
        alignItems="center"
        sx={{ pr: { md: 7 } }}
      >
        {pageChromeActions}
        <Button size="small" color="inherit" startIcon={<TuneOutlinedIcon />} onClick={openExportSettings} disabled={exporting}>
          Настроить экспорт
        </Button>
        {columnTools}
        {drillTitle && <Button size="small" color="inherit" startIcon={<RestartAltIcon />} onClick={resetRegisterFilters}>Показать весь реестр</Button>}
      </Stack>
    );
  }, [columnTools, drillTitle, exporting, openExportSettings, pageChromeActions, resetRegisterFilters, tableTabs]);
  usePageChromeActions(useMemo(() => {
    if (embedded || tableTabs) return null;
    const exportButton = (
      <Button
        size="small"
        color="inherit"
        startIcon={<TuneOutlinedIcon />}
        onClick={openExportSettings}
        disabled={exporting}
      >
        Настроить экспорт
      </Button>
    );
    if (hideHeader) {
      return (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {pageChromeActions}
          {exportButton}
          {columnTools}
          {drillTitle && <Button size="small" color="inherit" startIcon={<RestartAltIcon />} onClick={resetRegisterFilters}>Показать весь реестр</Button>}
        </Stack>
      );
    }
    if (!inRequestsPage) return pageChromeActions;
    return (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        <Button size="small" color="inherit" startIcon={<HistoryOutlinedIcon />} onClick={() => setRegisterHistoryOpen(true)}>История согласования</Button>
        {exportButton}
        {columnTools}
        {drillTitle && <Button size="small" color="inherit" startIcon={<RestartAltIcon />} onClick={resetRegisterFilters}>Показать весь реестр</Button>}
        {canUseApprovalMode && <Button size="small" variant="contained" startIcon={approvalMode ? <CloseIcon /> : <DoneAllIcon />} onClick={() => setApprovalModeEnabled(!approvalMode)}>{approvalMode ? 'Выйти из режима' : 'Перейти к согласованию'}</Button>}
      </Stack>
    );
  }, [approvalMode, canUseApprovalMode, columnTools, drillTitle, embedded, exporting, hideHeader, inRequestsPage, openExportSettings, pageChromeActions, resetRegisterFilters, tableTabs]));
  return <Stack spacing={1.1} className="approval-register-page">
    {tableTabs ? (
      <Card className="dashboard-hero" elevation={0}>
        <Box>
          <Typography variant="h5">Табличный вид</Typography>
          {tableTabs}
        </Box>
        {tableHeroActions}
      </Card>
    ) : null}
    {!inRequestsPage && !hideHeader ? (
      <Box sx={{ pt: 0.15 }}>
        <Typography fontWeight={700} letterSpacing="-0.02em" sx={{ fontSize: { xs: '1.2rem', md: '1.35rem' }, lineHeight: 1.2 }}>
          {embedded ? 'Проверка заявки' : 'Реестр бюджетных заявок'}
        </Typography>
      </Box>
    ) : null}
    <RegistryFilterBar
      view={view}
      filters={filters}
      onViewChange={setView}
      onChange={setFilters}
      onReset={resetRegisterFilters}
      onSave={saveCurrentFilter}
      availableViews={availableViews}
      groupBy={groupBy}
      onGroupByChange={setGroupBy}
      analyticsFilterOptions={analyticsFilterOptions}
      drillLabels={drillLabels}
      hideFlowSelect={Boolean(flow)}
    />
    {isLoading && !data && !approvalMode && (
      <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5 }} aria-hidden="true">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.5 }}>
          {Array.from({ length: 5 }, (_, index) => (
            <Box key={index}>
              <Skeleton width="55%" height={18} />
              <Skeleton width="82%" height={30} />
            </Box>
          ))}
        </Box>
      </Paper>
    )}
    {summaryAggregates && !approvalMode && <RegistrySummary aggregates={summaryAggregates} />}
    {!approvalMode && <AnalyticsSummaryList summary={analyticsSummary} />}
    {approvalMode && hasSelection && (
      <SelectionBar
        selectionRoots={selectionRoots}
        selectedRows={selectedRows}
        canApprove={selectionRoots.length === 0
          ? selectedRows.some((row) => isRowActionable(row, user.role))
          : selectionRoots.some((group) => user.role === 'employee' && groupHasCfoActions(group))
            || (user.role !== 'employee' && selectedRows.some((row) => isRowActionable(row, user.role)))}
        canReject={user.role === 'approver' || user.role === 'zgd'
          ? selectedRows.some((row) => row.is_workflow_submission_actionable)
            || selectionRoots.some((group) => groupHasWorkflowReturn(group, user.role))
          : selectedRows.some((row) => isRowActionable(row, user.role))
            || selectionRoots.some((group) => user.role === 'employee' ? cfoGroupsForReturn([group]).length > 0 : groupHasWorkflowActions(group, user.role))}
        canForward={selectionRoots.some((group) => user.role === 'employee'
          ? groupHasCfoCompleteActions(group) || groupHasWorkflowApprove(group, user.role)
          : groupHasWorkflowApprove(group, user.role))}
        forwarding={forwardApprovalGroups.isPending}
        onApprove={handleBulkApprove}
        onForward={() => {
          void openForwardDialog(selectionRoots.filter((group) => user.role === 'employee'
            ? groupHasCfoCompleteActions(group) || groupHasWorkflowApprove(group, user.role)
            : groupHasWorkflowApprove(group, user.role)));
        }}
        onReject={handleBulkReject}
        onClear={clearSelection}
      />
    )}
    {error && <Alert severity="error">Не удалось загрузить реестр. Повторите попытку.</Alert>}
    <Stack direction={{ xs: 'column', xl: approvalMode ? 'row' : 'column' }} spacing={1.1} alignItems="stretch">
    <TableContainer ref={tableContainerRef} component={Paper} variant="outlined" className="approval-register-table" sx={{ flex: 1, minWidth: 0, maxHeight: 'calc(100vh - 250px)', minHeight: 420, borderColor: 'rgba(15, 23, 42, 0.08)', borderRadius: 1.5 }}>
      <Table stickyHeader size="small" sx={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed', '& td, & th': { borderRight: '1px solid', borderColor: 'rgba(15, 23, 42, 0.06)', fontSize: 12 } }}>
        <colgroup>{visibleColumns.map((column) => <col key={column.id} style={{ width: effectiveWidths[column.id] }} />)}</colgroup>
        <TableHead sx={{ '& .MuiTableCell-root': { bgcolor: '#F8FAFC !important', backgroundImage: 'none', boxShadow: 'inset 0 -1px 0 rgba(15, 23, 42, 0.08)', py: 0.55, px: 0.75, fontSize: 12, fontWeight: 700, color: 'text.secondary' } }}>
          <TableRow>
            {visibleColumns.map((column) => {
              const movable = column.id !== 'select' && column.id !== 'structure';
              const fixed = column.id === 'select' || column.id === 'structure';
              const definition = REGISTRY_TABLE_COLUMN_DEFINITIONS.find((entry) => entry.id === column.id);
              return (
                <TableCell
                  key={column.id}
                  draggable={movable}
                  onDragStart={() => movable && setDraggedColumn(column.id)}
                  onDragEnd={() => setDraggedColumn(null)}
                  onDragOver={(event) => { if (movable && draggedColumn) event.preventDefault(); }}
                  onDrop={() => moveColumn(column.id)}
                  align={['requested', 'approved', 'rejected', 'pending'].includes(column.id) ? 'right' : column.id === 'select' ? 'center' : 'left'}
                  sx={{
                    width: effectiveWidths[column.id],
                    minWidth: effectiveWidths[column.id],
                    maxWidth: effectiveWidths[column.id],
                    overflow: 'visible',
                    position: 'sticky',
                    top: 0,
                    left: column.id === 'structure' ? effectiveWidths.select : fixed ? 0 : undefined,
                    zIndex: fixed ? 5 : 4,
                    bgcolor: draggedColumn === column.id ? '#E8EEF8 !important' : '#F8FAFC !important',
                    cursor: movable ? 'grab' : 'default',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'middle',
                  }}
                >
                  {column.id === 'select' ? (
                    <Checkbox
                      size="small"
                      checked={allApprovalRootsSelected}
                      indeterminate={hasSelection && !allApprovalRootsSelected}
                      disabled={!allApprovalRoots.length}
                      onChange={(_, checked) => void toggleAllSelected(checked)}
                      sx={{ p: 0.35 }}
                      inputProps={{ 'aria-label': allApprovalRootsSelected ? 'Снять выделение со всех строк' : 'Выбрать все доступные строки' }}
                    />
                  ) : (
                    <>
                      <TableColumnHeader
                        onOpenFilter={() => setFacetsRequested(true)}
                        label={
                          column.id === 'approved' && usesWorkflowStepColumns(user.role)
                            ? 'Согласовано, ₽'
                            : column.label
                        }
                        sortable={definition?.sortable !== false}
                        filterable={definition?.filterable !== false}
                        sortDirection={columnControls.sort?.column === column.id ? columnControls.sort.direction : null}
                        onSortAscending={() => columnControls.setSortAscending(column.id)}
                        onSortDescending={() => columnControls.setSortDescending(column.id)}
                        onClearSort={() => columnControls.clearSort(column.id)}
                        filterOptions={columnControls.filterOptions[column.id]}
                        selectedFilterValues={columnControls.selectedFilterValues[column.id]}
                        filterSearchValue={columnControls.filterSearchValues[column.id]}
                        onFilterSearchChange={(value) => columnControls.setFilterSearchValue(column.id, value)}
                        onToggleFilterValue={(value) => columnControls.toggleFilterOption(column.id, value)}
                        onSelectAllFilterValues={() => columnControls.setAllFilterOptions(column.id)}
                        onClearColumnFilter={() => columnControls.clearColumnFilter(column.id)}
                        onClearVisibleFilterValues={() => columnControls.setVisibleFilterOptions(column.id, false)}
                        formatFilterOptionLabel={column.id === 'status' ? (option) => option.label.replace(/^(group|row):/, '') : undefined}
                        filterOptionSection={column.id === 'status' ? (option) => (
                          option.value.startsWith('group:') ? 'Статусы группировок' : 'Статусы строк заявок'
                        ) : undefined}
                      />
                      <TableColumnResizeHandle
                        onPointerDown={(event) => resizeColumn(column.id, event)}
                        onDoubleClick={() => autoFitColumn(column.id)}
                      />
                    </>
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {isLoading && !data && <TableRowsSkeleton rows={9} columns={visibleColumns.length} />}
          {isFetching && data && <TableRow><TableCell colSpan={visibleColumns.length} sx={{ py: 0.5, bgcolor: '#f8fbff' }}><Typography variant="caption" color="text.secondary">Обновление…</Typography></TableCell></TableRow>}
          {data && !displayRegisterGroups.length && (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} align="center" sx={{ py: 4, fontSize: 13 }}>
                {hasActiveTableFilters
                  ? 'Нет строк по выбранным условиям. Нажмите «Сбросить» — после передачи экономисту заявки уже не в статусе «На проверке».'
                  : 'Нет строк по выбранным условиям.'}
              </TableCell>
            </TableRow>
          )}
          {data && (
            <RegisterQueryContext.Provider value={registerQuery}>
            <FilteredRegisterItemsContext.Provider value={filteredItemsByGroup}>
            <PointRevisionContext.Provider value={markPointRevision}>
            <RegisterViewContext.Provider value={view}>
            <VirtualTreeRows
              scrollRef={tableContainerRef}
              groups={displayRegisterGroups}
              level={0}
              expanded={expanded}
              filters={effectiveFilters}
              columns={visibleColumns}
              widths={effectiveWidths}
              selectedIds={new Set(selected.keys())}
              selectedRows={selectedRows}
              selectedGroupIds={new Set(selectedGroups.keys())}
              activeId={activeItem?.id || null}
              onToggle={toggleGroup}
              onToggleSelected={toggleRowSelected}
              onToggleGroupSelected={toggleGroupSelected}
              onActive={setActiveItem}
              onDecision={(target) => {
                setDecisionTarget(target);
              }}
              onSaveRowDecision={handleSaveRowDecision}
              onOpen={setDetailsItem}
              onHistory={openHistory}
              onApproveGroup={(group) => setGroupsToApprove([group])}
              onCfoReviewReject={(group) => { void openGroupReject([group]); }}
              onCfoReviewReturn={(group) => openGroupRevision([group], 'cfo')}
              onCompleteCfoReview={(group) => completeCfoReviewGroups.mutate([group])}
              onWorkflowApprove={(group) => workflowGroupAction.mutate({ groups: [group], action: 'approve' })}
              onWorkflowDecision={(group) => { void openWorkflowGroupDecision(group); }}
              onWorkflowReject={(group) => { void openGroupReject([group]); }}
              onWorkflowReturn={(group) => openGroupRevision([group], 'workflow')}
              onWorkflowFix={(group, unlock) => workflowGroupAction.mutate({ groups: [group], action: unlock ? 'unfix' : 'fix' })}
              onItems={registerGroupItems}
              requestId={requestId}
              user={user}
              approvalMode={approvalMode}
              view={view}
              visibleGroupIds={null}
              visibleItemIds={visibleItemIds}
              columnSort={columnControls.sort}
            />
            </RegisterViewContext.Provider>
            </PointRevisionContext.Provider>
            </FilteredRegisterItemsContext.Provider>
            </RegisterQueryContext.Provider>
          )}
        </TableBody>
      </Table>
    </TableContainer>
    {approvalMode && <ApprovalRoutePanel requestId={requestId} user={user} />}
    </Stack>
    <RegistryFooter totalRows={summaryAggregates?.total_rows || 0} />
    <DecisionDialog target={decisionTarget} saving={decide.isPending} onClose={() => setDecisionTarget(null)} onSave={(decision, comment, amount) => decisionTarget && decide.mutate({ target: { ...decisionTarget, decision }, comment, amount })} />
    <ConfirmDialog
      open={groupsToApprove.length > 0}
      title={groupsToApprove.length === 1 ? `Согласовать ${groupsToApprove[0]?.type === 'cfo' ? 'ЦФО' : 'статью'}` : 'Согласовать выбранные группы'}
      description={groupsToApprove.length > 0 && (
        <Stack spacing={0.5}>
          {groupsToApprove.length === 1 ? (
            <Typography>Будут согласованы все доступные для вас строки группы «{groupsToApprove[0].name}».</Typography>
          ) : (
            <Typography>Будут согласованы все доступные строки в {groupsToApprove.length} выбранных группах.</Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Строк: {groupsToApprove.reduce((total, group) => total + group.aggregates.total_rows, 0)} · запрошено: {money(groupsToApprove.reduce((total, group) => total + group.aggregates.requested_sum, 0))}
          </Typography>
        </Stack>
      )}
      confirmLabel={approveGroups.isPending ? 'Сохраняется…' : 'Согласовать'}
      confirmColor="success"
      pending={approveGroups.isPending}
      onClose={() => setGroupsToApprove([])}
      onConfirm={() => groupsToApprove.length > 0 && approveGroups.mutate(groupsToApprove)}
    />
    <ForwardDetailsDialog
      open={groupsToForward.length > 0}
      groups={groupsToForward}
      lines={forwardLines}
      loading={forwardLinesLoading}
      pending={forwardApprovalGroups.isPending}
      onClose={() => {
        setGroupsToForward([]);
        setForwardLines([]);
      }}
      onConfirm={() => groupsToForward.length > 0 && forwardApprovalGroups.mutate(groupsToForward)}
    />
    <ExportSettingsDialog
      open={exportOpen}
      settings={exportSettings}
      units={units}
      statusOptions={REGISTER_EXPORT_STATUSES}
      filterNote={filteredExportItemIds === null
        ? 'Настройки подставлены из фильтров страницы. Выгрузка повторяет текущую таблицу: сводку, аналитику, иерархию реестра и помесячные планы.'
        : `Применены фильтры по столбцам: в выгрузку попадут только ${filteredExportItemIds.length} строк(и), видимые в таблице.`}
      exporting={exporting}
      onClose={() => setExportOpen(false)}
      onChange={setExportSettings}
      onExport={() => { void exportRegister(); }}
    />
      <ArticleRevisionDialog
        open={!!revisionDialog}
        onClose={() => setRevisionDialog(null)}
        onSuccess={() => {
          const mode = revisionDialog?.mode;
          refreshAfterRevision();
          toast(
            mode === 'cfo'
              ? 'Строки отправлены ответственному за модуль на доработку.'
              : 'Строки отмечены на доработку.',
            'success',
          );
        }}
        mode={revisionDialog?.mode || 'cfo'}
      target={revisionDialog?.target}
      initialLines={revisionDialog?.initialLines}
      requestId={requestId}
      user={user}
    />
    <RegistryDetailsDrawer item={detailsItem} onClose={() => setDetailsItem(null)} onOpenHistory={openHistory} />
    <RequestHistoryDrawer target={historyTarget} onClose={() => setHistoryTarget(null)} />
    <RegisterHistoryDrawer open={registerHistoryOpen} onClose={() => setRegisterHistoryOpen(false)} />
  </Stack>;
}
