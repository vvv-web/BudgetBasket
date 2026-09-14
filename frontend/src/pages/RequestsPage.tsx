import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, lazy, Suspense, useMemo, useState, useEffect, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportSettingsDialog } from '../components/ExportSettingsDialog';
import { PageSkeleton } from '../components/PageSkeleton';
import { RequestHistoryDrawer, type RequestHistoryTarget } from '../components/request-history/RequestHistoryDrawer';
import { useAppToast } from '../components/Layout';
import { TableColumnHeader, TableColumnResizeHandle, TableColumnTools } from '../components/TableColumnControls';
import { RequestStatusBadge, StepStatusBadge } from '../components/StatusBadge';
import type { BudgetItem, BudgetRequest, CatalogItem, Unit, User } from '../types';
import { CLOSED_EXPORT_STATUSES, defaultExportSettings, exportSettingsFromRequestPage, type ExportSettingsState } from '../utils/exportSettings';
import { downloadBlob } from '../utils/download';
import { money, requestStatusLabels } from '../utils/labels';
import { filterFieldSx } from '../utils/responsive';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';
import { getApiErrorDetail, getApiErrorMessage, getDownloadApiErrorMessage } from '../utils/apiErrors';

const ApprovalRegister = lazy(() => import('../components/ApprovalRegister').then((module) => ({
  default: module.ApprovalRegister,
})));

function existingRequestId(error: unknown): string | null {
  const detail = getApiErrorDetail(error);
  if (!detail || typeof detail !== 'object' || !('request_id' in detail)) return null;
  const requestId = (detail as { request_id?: unknown }).request_id;
  return typeof requestId === 'string' && requestId ? requestId : null;
}

type RequestTableColumn = 'unit' | 'status' | 'my_step' | 'planned' | 'approved' | 'items_count' | 'actions';
type DeletePreviewColumn = 'kind' | 'name' | 'sum';
type DeletePreviewRow = {
  kind: string;
  name: string;
  sum: number;
};

type ZgdDetailRow = {
  request_id: string;
  organization: string;
  cfo: string;
  article: string;
  kind: 'dds' | 'invest';
  planned: number;
  approved: number;
};

type ZgdArticleGroup = {
  id: string;
  article: string;
  planned: number;
  approved: number;
  requests: Array<{ request: BudgetRequest; planned: number; approved: number }>;
};

type ZgdCfoGroup = {
  id: string;
  cfo: string;
  planned: number;
  approved: number;
  articles: ZgdArticleGroup[];
};

type ZgdDepartmentGroup = {
  id: string;
  department: string;
  planned: number;
  approved: number;
  cfoGroups: ZgdCfoGroup[];
};

type ZgdArticleAccumulator = ZgdArticleGroup & {
  requestsById: Map<string, { request: BudgetRequest; planned: number; approved: number }>;
};

type ZgdCfoAccumulator = ZgdCfoGroup & {
  articlesById: Map<string, ZgdArticleAccumulator>;
};

type ZgdDepartmentAccumulator = ZgdDepartmentGroup & {
  cfoGroupsById: Map<string, ZgdCfoGroup>;
};

const REQUEST_TABLE_COLUMN_WIDTHS: Record<RequestTableColumn, number> = {
  unit: 300,
  status: 380,
  my_step: 190,
  planned: 160,
  approved: 180,
  items_count: 120,
  actions: 160,
};

const REQUEST_TABLE_COLUMN_MIN_WIDTHS: Record<RequestTableColumn, number> = {
  unit: 180,
  status: 220,
  my_step: 150,
  planned: 130,
  approved: 140,
  items_count: 100,
  actions: 100,
};

function RequestsListPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    frozen: searchParams.get('frozen') || '',
    flow: '' as '' | 'expense' | 'income',
  });
  useEffect(() => {
    setFilters({
      status: searchParams.get('status') || '',
      frozen: searchParams.get('frozen') || '',
      flow: (searchParams.get('flow') as '' | 'expense' | 'income') || '',
    });
  }, [searchParams]);
  const [expandedZgdDepartments, setExpandedZgdDepartments] = useState<string[]>([]);
  const [expandedZgdCfos, setExpandedZgdCfos] = useState<string[]>([]);
  const [expandedZgdArticles, setExpandedZgdArticles] = useState<string[]>([]);
  const [requestColumnOrder, setRequestColumnOrder] = useState<RequestTableColumn[]>(['actions', 'unit', 'status', 'my_step', 'planned', 'approved', 'items_count']);
  const [draggedRequestColumn, setDraggedRequestColumn] = useState<RequestTableColumn | null>(null);
  const [createError, setCreateError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettingsState>(() => defaultExportSettings(user));
  const [deleteTarget, setDeleteTarget] = useState<BudgetRequest | null>(null);
  const [historyTarget, setHistoryTarget] = useState<RequestHistoryTarget | null>(null);
  const deleteTargetId = deleteTarget?.id || '';

  const { data: units = [], isLoading: unitsLoading } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });
  const { data: deleteTargetRequest } = useQuery({
    queryKey: ['request-delete-preview', deleteTargetId],
    queryFn: async () => (await api.get<BudgetRequest>(`/requests/${deleteTargetId}`)).data,
    enabled: !!deleteTargetId,
  });
  const { data: deleteTargetDds = [] } = useQuery({
    queryKey: ['request-delete-preview-dds', deleteTargetId],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${deleteTargetId}/items`)).data.filter((item) => !!item.dds_id && item.status !== 'deleted'),
    enabled: !!deleteTargetRequest,
  });
  const { data: deleteTargetInvest = [] } = useQuery({
    queryKey: ['request-delete-preview-invest', deleteTargetId],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${deleteTargetId}/items`)).data.filter((item) => !!item.invest_id && item.status !== 'deleted'),
    enabled: !!deleteTargetRequest,
  });
  const { data: deleteTargetDdsCatalog = [] } = useQuery({
    queryKey: ['request-delete-preview-dds-catalog', deleteTargetRequest?.unit_id],
    queryFn: async () =>
      (
        await api.get<CatalogItem[]>('/catalog/dds', {
          params: { module_id: deleteTargetRequest?.unit_id, active_only: true },
        })
      ).data,
    enabled: !!deleteTargetRequest?.unit_id,
  });
  const { data: deleteTargetInvestCatalog = [] } = useQuery({
    queryKey: ['request-delete-preview-invest-catalog', deleteTargetRequest?.unit_id],
    queryFn: async () =>
      (
        await api.get<CatalogItem[]>('/catalog/invests', {
          params: { module_id: deleteTargetRequest?.unit_id, active_only: true },
        })
      ).data,
    enabled: !!deleteTargetRequest?.unit_id,
  });
  const { data = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['requests', filters.status],
    queryFn: async () =>
      (
        await api.get<BudgetRequest[]>('/requests', {
          params: { status: filters.status || undefined },
        })
      ).data,
  });
  const { data: zgdDetailRows = [], isLoading: zgdDetailsLoading } = useQuery({
    queryKey: ['zgd-request-groups'],
    queryFn: async () => {
      const [expenses, income] = await Promise.all([
        api.get<ZgdDetailRow[]>('/dashboard/table', { params: { is_income: false } }),
        api.get<ZgdDetailRow[]>('/dashboard/table', { params: { is_income: true } }),
      ]);
      return [...expenses.data, ...income.data];
    },
    enabled: user.role === 'zgd',
  });
  const filteredRequests = useMemo(
    () => data.filter((request) => {
      const planned = request.summary?.planned_sum ?? request.sum_plan ?? request.sum ?? 0;
      const incomePlanned = request.summary?.income_planned_sum ?? 0;
      if (filters.flow === 'income' && incomePlanned <= 0) return false;
      if (filters.flow === 'expense' && planned - incomePlanned <= 0) return false;
      if (!filters.frozen) return true;
      if (filters.frozen === 'fixed') return request.fixed;
      if (filters.frozen === 'frozen') return request.frozen && !request.fixed;
      return !request.frozen;
    }),
    [data, filters.flow, filters.frozen],
  );
  const zgdGroups = useMemo<ZgdDepartmentGroup[]>(() => {
    if (user.role !== 'zgd') return [];
    const visibleRequests = new Map(filteredRequests.map((request) => [request.id, request]));
    const cfoGroups = new Map<string, ZgdCfoAccumulator>();
    const departmentByCfoId = new Map<string, string>();

    zgdDetailRows.forEach((row) => {
      const request = visibleRequests.get(row.request_id);
      if (!request) return;
      const cfoId = row.cfo || 'Не указан';
      const articleId = `${row.kind}\u0000${row.article}`;
      const cfoGroupId = (row.organization || '') + '\u0000' + cfoId;
      const cfoGroup = cfoGroups.get(cfoGroupId) || {
        id: cfoGroupId,
        cfo: cfoId,
        planned: 0,
        approved: 0,
        articles: [],
        articlesById: new Map(),
      };
      const articleGroup = cfoGroup.articlesById.get(articleId) || {
        id: `${cfoId}\u0000${articleId}`,
        article: row.article,
        planned: 0,
        approved: 0,
        requests: [],
        requestsById: new Map(),
      };
      const requestGroup = articleGroup.requestsById.get(request.id) || { request, planned: 0, approved: 0 };
      requestGroup.planned += row.planned;
      requestGroup.approved += row.approved;
      articleGroup.requestsById.set(request.id, requestGroup);
      articleGroup.planned += row.planned;
      articleGroup.approved += row.approved;
      cfoGroup.articlesById.set(articleId, articleGroup);
      cfoGroup.planned += row.planned;
      cfoGroup.approved += row.approved;
      cfoGroups.set(cfoGroupId, cfoGroup);
      departmentByCfoId.set(cfoGroupId, row.organization || 'Не указано');
    });

    const departmentGroups = new Map<string, ZgdDepartmentAccumulator>();
    [...cfoGroups.values()].forEach(({ articlesById, ...cfo }) => {
      const departmentId = departmentByCfoId.get(cfo.id) || 'Не указано';
      const departmentGroup = departmentGroups.get(departmentId) || {
        id: departmentId,
        department: departmentId,
        planned: 0,
        approved: 0,
        cfoGroups: [],
        cfoGroupsById: new Map(),
      };
      departmentGroup.cfoGroupsById.set(cfo.id, {
        ...cfo,
        articles: [...articlesById.values()]
          .map(({ requestsById, ...article }) => ({
            ...article,
            requests: [...requestsById.values()].sort((left, right) => (left.request.unit_id || '').localeCompare(right.request.unit_id || '')),
          }))
          .sort((left, right) => left.article.localeCompare(right.article, 'ru')),
      });
      departmentGroup.planned += cfo.planned;
      departmentGroup.approved += cfo.approved;
      departmentGroups.set(departmentId, departmentGroup);
    });

    return [...departmentGroups.values()]
      .map(({ cfoGroupsById, ...department }) => ({
        ...department,
        cfoGroups: [...cfoGroupsById.values()].sort((left, right) => left.cfo.localeCompare(right.cfo, 'ru')),
      }))
      .sort((left, right) => left.department.localeCompare(right.department, 'ru'));
  }, [filteredRequests, user.role, zgdDetailRows]);

  const forwardPackage = useMutation({
    mutationFn: ({ stepId, requestIds }: { stepId: string; requestIds: string[] }) => api.post(`/steps/${stepId}/approve`, { request_ids: requestIds }),
    onSuccess: () => {
      toast('Пакет передан на следующий этап', 'success');
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-approval-steps'] });
      queryClient.invalidateQueries({ queryKey: ['step-requests'] });
    },
    onError: (error) => toast(getApiErrorMessage(error, 'Не удалось передать пакет'), 'error'),
  });

  const allModules = units.filter((unit) => unit.type === 'department' || unit.type === 'module');
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const forwardPackages = useMemo(() => {
    if (user.role !== 'approver') return [];
    const packageKeys = new Map<string, { stepId: string; packageName: string }>();
    filteredRequests.forEach((request) => {
      (request.my_step_statuses || []).forEach((step) => {
        // One package = all requests that share the same route step.
        if (!['on_approval', 'on_revision', 'approved'].includes(step.status)) return;
        packageKeys.set(step.step_id, {
          stepId: step.step_id,
          packageName: 'Цепочка согласования',
        });
      });
    });
    const groups = new Map<string, {
      stepId: string;
      packageName: string;
      requests: BudgetRequest[];
      forwarded: boolean;
    }>();
    filteredRequests.forEach((request) => {
      (request.my_step_statuses || []).forEach((step) => {
        const meta = packageKeys.get(step.step_id);
        if (!meta) return;
        if (!['waiting', 'on_approval', 'on_revision', 'approved'].includes(step.status)) return;
        const group = groups.get(step.step_id) || { ...meta, requests: [], forwarded: false };
        if (!group.requests.some((item) => item.id === request.id)) {
          group.requests.push(request);
        }
        groups.set(step.step_id, group);
      });
    });
    return [...groups.values()]
      .map((group) => {
        const atStep = group.requests.filter((request) => (
          request.my_step_statuses?.some((step) => step.step_id === group.stepId && step.status === 'on_approval')
        ));
        const forwarded = group.requests.length > 0
          && atStep.length === 0
          && group.requests.every((request) => (
            request.my_step_statuses?.some((step) => step.step_id === group.stepId && step.status === 'approved')
          ));
        return { ...group, forwarded };
      })
      .sort((left, right) => {
        if (left.forwarded !== right.forwarded) return left.forwarded ? 1 : -1;
        return left.stepId.localeCompare(right.stepId);
      });
  }, [filteredRequests, user.role]);
  const packageByRequestId = useMemo(() => new Map(
    forwardPackages.flatMap((packageItem) => packageItem.requests.map((request) => [request.id, packageItem] as const)),
  ), [forwardPackages]);
  const formatUnitName = (unitId: string | null | undefined) => units.find((unit) => unit.id === unitId)?.name || unitId || '—';
  const employeeUnitNames = useMemo(
    () => (user.unit_ids || []).map((unitId) => formatUnitName(unitId)).filter(Boolean),
    [units, user.unit_ids],
  );

  const employeeModules = useMemo(() => {
    if (user.role !== 'employee') return allModules;
    const assignedUnits = new Set(user.unit_ids || []);
    return allModules.filter((module) => {
      let current: Unit | undefined = module;
      while (current) {
        if (assignedUnits.has(current.id)) return true;
        current = current.parent_id ? unitById.get(current.parent_id) : undefined;
      }
      return false;
    });
  }, [allModules, unitById, user.role, user.unit_ids]);

  const create = useMutation({
    mutationFn: (unitId: string) => api.post<BudgetRequest>('/requests', { unit_id: unitId }),
    onSuccess: (response) => {
      setCreateError('');
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка создана', 'success');
      navigate(`/requests/${response.data.id}`);
    },
    onError: (error) => {
      const requestId = existingRequestId(error);
      if (requestId) {
        setCreateError('');
        queryClient.invalidateQueries({ queryKey: ['requests'] });
        toast('Открыта существующая заявка текущего года', 'info');
        navigate(`/requests/${requestId}`);
        return;
      }
      setCreateError(getApiErrorMessage(error, 'Заявку не удалось создать'));
      toast('Не удалось создать заявку', 'error');
    },
  });

  const deleteRequest = useMutation({
    mutationFn: (requestId: string) => api.delete(`/requests/${requestId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка удалена', 'success');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast(getApiErrorMessage(error, 'Не удалось удалить заявку'), 'error');
    },
  });

  const restoreRequest = useMutation({
    mutationFn: (requestId: string) => api.post(`/requests/${requestId}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast('Заявка восстановлена в черновик', 'success');
    },
    onError: (error) => {
      toast(getApiErrorMessage(error, 'Не удалось восстановить заявку'), 'error');
    },
  });

  const requestAmounts = (request: BudgetRequest) => {
    const planned = request.summary?.planned_sum ?? request.sum_plan ?? request.sum ?? 0;
    const approved = request.summary?.approved_sum ?? (request.status === 'cancelled' ? 0 : request.sum);
    const incomePlanned = request.summary?.income_planned_sum ?? 0;
    const incomeApproved = request.summary?.income_approved_sum ?? 0;
    if (filters.flow === 'income') return { planned: incomePlanned, approved: incomeApproved };
    if (filters.flow === 'expense') return { planned: planned - incomePlanned, approved: approved - incomeApproved };
    return { planned, approved };
  };

  const exportClosed = async () => {
    setExportError('');
    setExporting(true);
    try {
      const response = await api.get('/requests/export/closed', {
        params: {
          department_ids: exportSettings.department_ids.join(',') || undefined,
          module_ids: exportSettings.module_ids.join(',') || undefined,
          // The export is always limited to rows currently visible in the
          // requests table, so its contents cannot silently ignore filters.
          request_ids: visibleRequests.map((request) => request.id).join(','),
          statuses: exportSettings.statuses.join(','),
          fixed_only: exportSettings.fixed_only,
          export_kind: filters.flow || exportSettings.export_kind,
          include_files: exportSettings.include_files,
        },
        responseType: 'blob',
      });
      const exportKind = filters.flow || exportSettings.export_kind;
      const baseFilename = user.role === 'zgd'
        ? 'Заявки_ЗГД'
        : exportKind === 'income'
        ? 'Доходы_бюджета'
        : exportKind === 'expense'
          ? 'Расходы_бюджета'
          : exportSettings.fixed_only ? 'Зафиксированные_заявки' : 'Утверждение_бюджета';
      downloadBlob(response.data, `${baseFilename}.${exportSettings.include_files ? 'zip' : 'xlsx'}`);
      setExportOpen(false);
    } catch (error) {
      setExportError(await getDownloadApiErrorMessage(error, 'Нет заявок для выбранных настроек экспорта или недостаточно прав.'));
    } finally {
      setExporting(false);
    }
  };

  const deletePreviewRows = useMemo<DeletePreviewRow[]>(() => {
    const ddsRows = deleteTargetDds.map((item) => ({
      kind: 'ДДС',
      name: deleteTargetDdsCatalog.find((entry) => entry.id === item.dds_id)?.name || item.dds_id || '',
      sum: item.sum_plan,
    }));
    const investRows = deleteTargetInvest.map((item) => ({
      kind: 'Инвест',
      name: deleteTargetInvestCatalog.find((entry) => entry.id === item.invest_id)?.name || item.invest_id || '',
      sum: item.sum_plan,
    }));
    return [...ddsRows, ...investRows];
  }, [deleteTargetDds, deleteTargetDdsCatalog, deleteTargetInvest, deleteTargetInvestCatalog]);

  const requestTableColumns = useMemo<TableColumnDefinition<BudgetRequest, RequestTableColumn>[]>(() => {
    const columns: TableColumnDefinition<BudgetRequest, RequestTableColumn>[] = [
    ...(user.role === 'employee' ? [{ id: 'actions' as const, label: 'Действие', sortable: false, filterable: false, hideable: false, getValue: () => '' }] : []),
    { id: 'unit', label: 'Объединение заявки', getValue: (item) => formatUnitName(item.unit_id) },
    { id: 'status', label: 'Статус', getValue: (item) => requestStatusLabels[item.status] || item.status },
    ...(user.role === 'approver' || user.role === 'zgd' ? [{ id: 'my_step' as const, label: 'Мой этап', getValue: (item: BudgetRequest) => item.my_step_statuses?.map((step) => step.reviewed ? 'Согласовано' : step.status).join(', ') || '—' }] : []),
    { id: 'planned', label: 'План', getValue: (item) => money(requestAmounts(item).planned), getSortValue: (item) => requestAmounts(item).planned },
    { id: 'approved', label: 'Утверждено', getValue: (item) => money(requestAmounts(item).approved), getSortValue: (item) => requestAmounts(item).approved },
    { id: 'items_count', label: 'Строк', getValue: (item) => String(item.summary?.items_count || 0), getSortValue: (item) => item.summary?.items_count || 0 },
    ];
    return columns.sort((left, right) => requestColumnOrder.indexOf(left.id) - requestColumnOrder.indexOf(right.id));
  }, [filters.flow, formatUnitName, requestColumnOrder, user.role]);
  const {
    clearColumnFilter: clearRequestColumnFilter,
    clearSort: clearRequestSort,
    filterOptions: requestFilterOptions,
    filterSearchValues: requestFilterSearchValues,
    hasActiveFilters: hasActiveRequestFilters,
    resetFilters: resetRequestFilters,
    resetVisibility: resetRequestVisibility,
    rows: visibleRequests,
    selectedFilterValues: selectedRequestFilterValues,
    setAllFilterOptions: setAllRequestFilterOptions,
    setFilterSearchValue: setRequestFilterSearchValue,
    setSortAscending: setRequestSortAscending,
    setSortDescending: setRequestSortDescending,
    setVisibleFilterOptions: setRequestVisibleFilterOptions,
    sort: requestSort,
    toggleFilterOption: toggleRequestFilterOption,
    toggleVisibility: toggleRequestVisibility,
    visibility: requestVisibility,
    visibleColumns: visibleRequestColumns,
  } = useTableColumnControls({ rows: filteredRequests, columns: requestTableColumns });
  const tableRequests = useMemo(() => {
    if (user.role !== 'approver') return visibleRequests;
    const packagedIds = new Set(packageByRequestId.keys());
    return [
      ...forwardPackages.flatMap((packageItem) => packageItem.requests),
      ...visibleRequests.filter((request) => !packagedIds.has(request.id)),
    ];
  }, [forwardPackages, packageByRequestId, user.role, visibleRequests]);
  const requestColumnLabels: Record<RequestTableColumn, string> = {
    actions: 'Действие',
    unit: 'Объединение заявки',
    status: 'Статус',
    my_step: 'Мой этап',
    planned: 'План',
    approved: 'Утверждено',
    items_count: 'Строк',
  };
  const requestAutoFitValues = useMemo(() => {
    const values = {} as Record<RequestTableColumn, Array<string | number>>;
    (Object.keys(REQUEST_TABLE_COLUMN_WIDTHS) as RequestTableColumn[]).forEach((columnId) => {
      const cellValues = tableRequests.map((item) => {
        if (columnId === 'unit') return formatUnitName(item.unit_id);
        if (columnId === 'status') return requestStatusLabels[item.status] || item.status;
        if (columnId === 'my_step') return item.my_step_statuses?.map((step) => step.reviewed ? 'Согласовано' : step.status).join(', ') || '—';
        if (columnId === 'planned') return money(requestAmounts(item).planned);
        if (columnId === 'approved') return money(requestAmounts(item).approved);
        if (columnId === 'items_count') return item.summary?.items_count || 0;
        return 'Удалить';
      });
      values[columnId] = [requestColumnLabels[columnId], ...cellValues];
    });
    return values;
  }, [filters.flow, tableRequests, units]);
  const { columnWidths: requestColumnWidths, resetColumnWidths: resetRequestColumnWidths, resizeColumn: resizeRequestColumn, autoFitColumn: autoFitRequestColumn } = useTableColumnWidths(
    REQUEST_TABLE_COLUMN_WIDTHS,
    REQUEST_TABLE_COLUMN_MIN_WIDTHS,
    requestAutoFitValues,
  );
  const requestTableWidth = visibleRequestColumns.reduce((sum, column) => sum + requestColumnWidths[column.id], 0);
  const fitRequestColumn = (columnId: RequestTableColumn) => {
    autoFitRequestColumn(columnId, requestAutoFitValues[columnId] || [requestColumnLabels[columnId]]);
  };
  const moveRequestColumn = (target: RequestTableColumn) => {
    if (!draggedRequestColumn || draggedRequestColumn === target) return;
    setRequestColumnOrder((current) => {
      const next = current.filter((column) => column !== draggedRequestColumn);
      next.splice(next.indexOf(target), 0, draggedRequestColumn);
      return next;
    });
    setDraggedRequestColumn(null);
  };
  const renderRequestCell = (item: BudgetRequest, columnId: RequestTableColumn) => {
    const canDelete = item.status === 'draft' && user.role === 'employee' && item.available_actions?.includes('delete');
    const canRestore = item.status === 'cancelled'
      && user.role === 'employee'
      && item.available_actions?.includes('restore');
    if (columnId === 'actions') {
      return (
        <TableCell key={columnId}>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="История изменений">
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  setHistoryTarget({
                    requestId: item.id,
                    title: 'История изменений',
                    subtitle: `Заявка №${item.id.slice(0, 8)}`,
                  });
                }}
                aria-label="История изменений"
              >
                <HistoryOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {canRestore ? (
              <Tooltip title="Восстановить заявку">
                <span>
                  <IconButton
                    size="small"
                    color="warning"
                    disabled={restoreRequest.isPending}
                    onClick={(event) => { event.stopPropagation(); restoreRequest.mutate(item.id); }}
                    aria-label="Восстановить заявку"
                  >
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            {canDelete ? (
              <Tooltip title="Удалить черновик">
                <IconButton
                  size="small"
                  color="error"
                  onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }}
                  aria-label="Удалить черновик"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        </TableCell>
      );
    }
    if (columnId === 'unit') return <TableCell key={columnId}>{formatUnitName(item.unit_id)}</TableCell>;
    if (columnId === 'status') return <TableCell key={columnId}><Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap><RequestStatusBadge status={item.status} />{item.frozen && <Tooltip title={item.fixed ? 'Окончательно зафиксирована ЗГД' : 'Заморожена экономистом'}><LockOutlinedIcon aria-label={item.fixed ? 'Окончательно зафиксирована ЗГД' : 'Заморожена экономистом'} color={item.fixed ? 'success' : 'warning'} fontSize="small" /></Tooltip>}</Stack></TableCell>;
    if (columnId === 'my_step') return <TableCell key={columnId}><Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{(item.my_step_statuses || []).map((step, index) => <StepStatusBadge key={`${step.status}-${index}`} status={step.reviewed && step.status === 'on_approval' ? 'approved' : step.status} label={step.reviewed && step.status === 'on_approval' ? 'Согласовано' : undefined} />)}{!item.my_step_statuses?.length && '—'}</Stack></TableCell>;
    if (columnId === 'planned') return <TableCell key={columnId}>{money(requestAmounts(item).planned)}</TableCell>;
    if (columnId === 'approved') return <TableCell key={columnId}>{money(requestAmounts(item).approved)}</TableCell>;
    return <TableCell key={columnId}>{item.summary?.items_count || 0}</TableCell>;
  };
  const renderRequestHeader = (
    columnId: RequestTableColumn,
    label: ReactNode,
    options?: { sortable?: boolean; filterable?: boolean },
  ) => (
    <TableColumnHeader
      label={label}
      sortable={options?.sortable}
      filterable={options?.filterable}
      sortDirection={requestSort?.column === columnId ? requestSort.direction : null}
      onSortAscending={() => setRequestSortAscending(columnId)}
      onSortDescending={() => setRequestSortDescending(columnId)}
      onClearSort={() => clearRequestSort(columnId)}
      filterOptions={requestFilterOptions[columnId]}
      selectedFilterValues={selectedRequestFilterValues[columnId]}
      filterSearchValue={requestFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setRequestFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleRequestFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllRequestFilterOptions(columnId)}
      onClearColumnFilter={() => clearRequestColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setRequestVisibleFilterOptions(columnId, false)}
    />
  );

  const deletePreviewColumns = useMemo<TableColumnDefinition<DeletePreviewRow, DeletePreviewColumn>[]>(() => [
    { id: 'kind', label: 'Тип', getValue: (row) => row.kind },
    { id: 'name', label: 'Статья / проект', getValue: (row) => row.name },
    { id: 'sum', label: 'План', getValue: (row) => money(row.sum), getSortValue: (row) => row.sum },
  ], []);
  const {
    clearColumnFilter: clearDeletePreviewColumnFilter,
    clearSort: clearDeletePreviewSort,
    filterOptions: deletePreviewFilterOptions,
    filterSearchValues: deletePreviewFilterSearchValues,
    hasActiveFilters: hasActiveDeletePreviewFilters,
    resetFilters: resetDeletePreviewFilters,
    resetVisibility: resetDeletePreviewVisibility,
    rows: visibleDeletePreviewRows,
    selectedFilterValues: selectedDeletePreviewFilterValues,
    setAllFilterOptions: setAllDeletePreviewFilterOptions,
    setFilterSearchValue: setDeletePreviewFilterSearchValue,
    setSortAscending: setDeletePreviewSortAscending,
    setSortDescending: setDeletePreviewSortDescending,
    setVisibleFilterOptions: setDeletePreviewVisibleFilterOptions,
    sort: deletePreviewSort,
    toggleFilterOption: toggleDeletePreviewFilterOption,
    toggleVisibility: toggleDeletePreviewVisibility,
    visibility: deletePreviewVisibility,
    visibleColumns: visibleDeletePreviewColumns,
  } = useTableColumnControls({ rows: deletePreviewRows, columns: deletePreviewColumns });
  const renderDeletePreviewHeader = (
    columnId: DeletePreviewColumn,
    label: string,
  ) => (
    <TableColumnHeader
      label={label}
      sortDirection={deletePreviewSort?.column === columnId ? deletePreviewSort.direction : null}
      onSortAscending={() => setDeletePreviewSortAscending(columnId)}
      onSortDescending={() => setDeletePreviewSortDescending(columnId)}
      onClearSort={() => clearDeletePreviewSort(columnId)}
      filterOptions={deletePreviewFilterOptions[columnId]}
      selectedFilterValues={selectedDeletePreviewFilterValues[columnId]}
      filterSearchValue={deletePreviewFilterSearchValues[columnId]}
      onFilterSearchChange={(value) => setDeletePreviewFilterSearchValue(columnId, value)}
      onToggleFilterValue={(value) => toggleDeletePreviewFilterOption(columnId, value)}
      onSelectAllFilterValues={() => setAllDeletePreviewFilterOptions(columnId)}
      onClearColumnFilter={() => clearDeletePreviewColumnFilter(columnId)}
      onClearVisibleFilterValues={() => setDeletePreviewVisibleFilterOptions(columnId, false)}
    />
  );

  if (unitsLoading || requestsLoading || (user.role === 'zgd' && zgdDetailsLoading)) {
    return <PageSkeleton variant="table" label="Загрузка заявок" />;
  }

  return (
    <Stack spacing={3}>
      {exportError && <Alert severity="warning">{exportError}</Alert>}
      {createError && <Alert severity="error">{createError}</Alert>}

      <Paper className="surface-pad" elevation={0}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} className="page-filters" sx={{ flex: 1 }}>
              <TextField select label="Статус" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} sx={filterFieldSx(220)}>
                <MenuItem value="">Все</MenuItem>
                {Object.entries(requestStatusLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Вид бюджета" value={filters.flow} onChange={(event) => setFilters((current) => ({ ...current, flow: event.target.value as '' | 'expense' | 'income' }))} sx={filterFieldSx(180)}>
                <MenuItem value="">Все</MenuItem>
                <MenuItem value="expense">Расходы</MenuItem>
                <MenuItem value="income">Доходы</MenuItem>
              </TextField>
              <TextField select label="Блокировка заявки" value={filters.frozen} onChange={(event) => setFilters((current) => ({ ...current, frozen: event.target.value }))} sx={filterFieldSx(220)}>
                <MenuItem value="">Все заявки</MenuItem>
                <MenuItem value="frozen">Замороженные экономистом</MenuItem>
                <MenuItem value="fixed">Зафиксированные ЗГД</MenuItem>
                <MenuItem value="unfrozen">Доступные для изменения</MenuItem>
              </TextField>
              {user.role !== 'zgd' && (
                <TableColumnTools
                  columns={requestTableColumns}
                  visibility={requestVisibility}
                  onToggleColumn={toggleRequestVisibility}
                  onResetColumns={resetRequestVisibility}
                  onResetFilters={resetRequestFilters}
                  onResetWidths={resetRequestColumnWidths}
                  hasActiveFilters={hasActiveRequestFilters}
                />
              )}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {user.role === 'employee' ? (
                <Button startIcon={<AddIcon />} variant="contained" onClick={() => employeeModules[0] && create.mutate(employeeModules[0].id)} disabled={employeeModules.length === 0 || create.isPending}>
                  Добавить заявку
                </Button>
              ) : null}
              <Button startIcon={<TuneOutlinedIcon />} variant="outlined" onClick={() => {
                setExportSettings(exportSettingsFromRequestPage({ user, filters, visibleRequests, units }));
                setExportOpen(true);
              }}>
                Настроить экспорт
              </Button>
            </Stack>
          </Stack>
          {user.role === 'employee' ? (
            <Alert severity="info" variant="outlined">
              Объединение сотрудника: {employeeUnitNames.length ? employeeUnitNames.join(', ') : 'не назначено'}
            </Alert>
          ) : null}
          {user.role === 'zgd' ? (
            <Alert severity="info" variant="outlined">
              Заявки сгруппированы по подразделениям, группам и статьям. Раскройте группу и статью, чтобы перейти к конкретной заявке.
            </Alert>
          ) : ['economist', 'approver'].includes(user.role) ? (
            <Alert severity="info" variant="outlined">
              Здесь собраны заявки вашего маршрута. Откройте заявку, чтобы просмотреть её шаги и выполнить доступное действие согласования.
            </Alert>
          ) : null}
        </Stack>
      </Paper>

      <ExportSettingsDialog
        open={exportOpen}
        settings={exportSettings}
        units={units}
        statusOptions={CLOSED_EXPORT_STATUSES}
        filterNote="Настройки подставлены из фильтров страницы. В выгрузку попадут только заявки, которые видны в таблице."
        exporting={exporting}
        onClose={() => setExportOpen(false)}
        onChange={setExportSettings}
        onExport={() => { void exportClosed(); }}
      />

      {user.role === 'zgd' ? (
        <Paper className="table-surface" elevation={0}>
          <Table size="small" sx={{ minWidth: 980, tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '22%' }}>Подразделение</TableCell>
                <TableCell>Статья / заявка</TableCell>
                <TableCell sx={{ width: 210 }}>Статус</TableCell>
                <TableCell align="right" sx={{ width: 160 }}>План</TableCell>
                <TableCell align="right" sx={{ width: 170 }}>Факт</TableCell>
                <TableCell align="right" sx={{ width: 170 }}>Корректировка</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zgdGroups.map((departmentGroup) => {
                const departmentExpanded = expandedZgdDepartments.includes(departmentGroup.id);
                return (
                  <Fragment key={departmentGroup.id}>
                    <TableRow sx={{ bgcolor: '#F3F7FF' }}>
                      <TableCell colSpan={6} sx={{ py: 0.75 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <IconButton
                            size="small"
                            aria-label={`${departmentExpanded ? 'Свернуть' : 'Раскрыть'} подразделение ${departmentGroup.department}`}
                            onClick={() => setExpandedZgdDepartments((current) => current.includes(departmentGroup.id) ? current.filter((id) => id !== departmentGroup.id) : [...current, departmentGroup.id])}
                          >
                            <ExpandMoreIcon sx={{ transform: departmentExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} />
                          </IconButton>
                          <Typography fontWeight={700}>{departmentGroup.department}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                            Групп: {departmentGroup.cfoGroups.length} · План: {money(departmentGroup.planned)} · Факт: {money(departmentGroup.approved)} · Корректировка: {money(departmentGroup.approved - departmentGroup.planned)}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    {departmentExpanded && departmentGroup.cfoGroups.map((cfoGroup) => {
                      const cfoExpanded = expandedZgdCfos.includes(cfoGroup.id);
                      return (
                        <Fragment key={cfoGroup.id}>
                          <TableRow sx={{ bgcolor: '#F9FBFF' }}>
                            <TableCell colSpan={6} sx={{ py: 0.5, pl: 2 }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <IconButton
                                  size="small"
                                  aria-label={`${cfoExpanded ? 'Свернуть' : 'Раскрыть'} ${cfoGroup.cfo}`}
                                  onClick={() => setExpandedZgdCfos((current) => current.includes(cfoGroup.id) ? current.filter((id) => id !== cfoGroup.id) : [...current, cfoGroup.id])}
                                >
                                  <ExpandMoreIcon sx={{ transform: cfoExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} />
                                </IconButton>
                                <Typography fontWeight={600}>{cfoGroup.cfo}</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                                  Статей: {cfoGroup.articles.length} · План: {money(cfoGroup.planned)} · Факт: {money(cfoGroup.approved)} · Корректировка: {money(cfoGroup.approved - cfoGroup.planned)}
                                </Typography>
                              </Stack>
                            </TableCell>
                          </TableRow>
                          {cfoExpanded && cfoGroup.articles.map((articleGroup) => {
                            const articleExpanded = expandedZgdArticles.includes(articleGroup.id);
                            return (
                              <Fragment key={articleGroup.id}>
                                <TableRow hover sx={{ bgcolor: '#FBFCFE', cursor: 'pointer' }} onClick={() => setExpandedZgdArticles((current) => current.includes(articleGroup.id) ? current.filter((id) => id !== articleGroup.id) : [...current, articleGroup.id])}>
                                  <TableCell colSpan={3} sx={{ pl: 7 }}>
                                    <Stack direction="row" spacing={0.75} alignItems="center">
                                      <ExpandMoreIcon fontSize="small" sx={{ transform: articleExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} />
                                      <Typography fontWeight={600}>{articleGroup.article}</Typography>
                                      <Typography variant="caption" color="text.secondary">Заявок: {articleGroup.requests.length}</Typography>
                                    </Stack>
                                  </TableCell>
                                  <TableCell align="right">{money(articleGroup.planned)}</TableCell>
                                  <TableCell align="right">{money(articleGroup.approved)}</TableCell>
                                  <TableCell align="right">{money(articleGroup.approved - articleGroup.planned)}</TableCell>
                                </TableRow>
                                {articleExpanded && articleGroup.requests.map(({ request, planned, approved }) => (
                                  <TableRow key={request.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/requests/${request.id}`)}>
                                    <TableCell colSpan={2} sx={{ pl: 10 }}>
                                      <Typography variant="body2" fontWeight={600}>{formatUnitName(request.unit_id)}</Typography>
                                      <Typography variant="caption" color="text.secondary">Открыть заявку и её строки</Typography>
                                    </TableCell>
                                    <TableCell>
                                      <Stack direction="row" spacing={0.75} alignItems="center">
                                        <RequestStatusBadge status={request.status} />
                                        {request.frozen && <LockOutlinedIcon color={request.fixed ? 'success' : 'warning'} fontSize="small" />}
                                      </Stack>
                                    </TableCell>
                                    <TableCell align="right">{money(planned)}</TableCell>
                                    <TableCell align="right">{money(approved)}</TableCell>
                                    <TableCell align="right">{money(approved - planned)}</TableCell>
                                  </TableRow>
                                ))}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
              {zgdGroups.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center">Заявки по выбранным фильтрам не найдены</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      ) : (
      <Paper className="table-surface" elevation={0}>
        <Table size="small" sx={{ width: requestTableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {visibleRequestColumns.map((column) => <col key={column.id} style={{ width: requestColumnWidths[column.id] }} />)}
          </colgroup>
          <TableHead>
            <TableRow>
              {visibleRequestColumns.map((column) => (
                <TableCell
                  key={column.id}
                  draggable
                  onDragStart={() => setDraggedRequestColumn(column.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveRequestColumn(column.id)}
                  sx={{ position: 'relative', cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
                >
                  {renderRequestHeader(column.id, column.label, column.id === 'actions' ? { sortable: false, filterable: false } : undefined)}
                  <TableColumnResizeHandle onPointerDown={(event) => resizeRequestColumn(column.id, event)} onDoubleClick={() => fitRequestColumn(column.id)} />
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {tableRequests.map((item) => {
              const canDelete = item.status === 'draft' && user.role === 'employee' && item.available_actions?.includes('delete');
              const unitName = formatUnitName(item.unit_id);
              const packageItem = packageByRequestId.get(item.id);
              const isPackageStart = packageItem?.requests[0]?.id === item.id;
              const atStepRequests = packageItem?.requests.filter((request) => (
                request.my_step_statuses?.some((step) => step.step_id === packageItem.stepId && step.status === 'on_approval')
              )) || [];
              const reviewedCount = packageItem?.forwarded
                ? packageItem.requests.length
                : atStepRequests.filter((request) => (
                  request.my_step_statuses?.some((step) => step.step_id === packageItem!.stepId && step.reviewed)
                )).length;
              const packageReady = !!packageItem && !packageItem.forwarded && atStepRequests.length > 0 && reviewedCount === atStepRequests.length;
              return (
                <Fragment key={item.id}>
                {isPackageStart && packageItem && (
                  <TableRow key={`package-${packageItem.stepId}`} sx={{ bgcolor: packageItem.forwarded || packageReady ? '#F0FDF4' : '#F8FAFC' }}>
                    <TableCell colSpan={visibleRequestColumns.length} sx={{ py: 1.25 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                        <Box flex={1}>
                          <Typography fontWeight={700}>{packageItem.packageName || 'Цепочка согласования'}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {packageItem.forwarded
                              ? `Заявок в пакете: ${packageItem.requests.length} · передан дальше`
                              : `Заявок в пакете: ${packageItem.requests.length} · согласовано: ${reviewedCount}/${atStepRequests.length || packageItem.requests.length}`}
                          </Typography>
                        </Box>
                        {packageItem.forwarded ? (
                          <Button size="small" variant="outlined" color="success" disabled>
                            Пакет передан
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<FactCheckIcon />}
                            disabled={!packageReady || forwardPackage.isPending}
                            onClick={() => forwardPackage.mutate({
                              stepId: packageItem.stepId,
                              requestIds: atStepRequests.map((request) => request.id),
                            })}
                          >
                            Передать пакет
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
                <TableRow
                  hover
                  onClick={() => navigate(`/requests/${item.id}`)}
                  sx={{
                    cursor: 'pointer',
                    ...(packageItem ? { borderLeft: '3px solid', borderLeftColor: 'primary.light' } : {}),
                  }}
                  className={item.frozen ? 'fixed-request' : ''}
                >
                  {visibleRequestColumns.map((column) => renderRequestCell(item, column.id))}
                  {false && <>
                  {requestVisibility.actions && (
                    <TableCell>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-start">
                        {canDelete ? (
                          <Tooltip title="Удалить черновик">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }}
                              aria-label="Удалить черновик"
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Stack>
                    </TableCell>
                  )}
                  {requestVisibility.unit && <TableCell>{unitName}</TableCell>}
                  {requestVisibility.status && (
                    <TableCell>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        <RequestStatusBadge status={item.status} />
                        {item.frozen && (
                          <Tooltip title={item.fixed ? 'Окончательно зафиксирована ЗГД' : 'Заморожена экономистом'}>
                            <LockOutlinedIcon aria-label={item.fixed ? 'Окончательно зафиксирована ЗГД' : 'Заморожена экономистом'} color={item.fixed ? 'success' : 'warning'} fontSize="small" />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  )}
                  {requestVisibility.my_step && (
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {(item.my_step_statuses || []).map((step, index) => (
                          <StepStatusBadge
                            key={`${step.status}-${index}`}
                            status={step.reviewed && step.status === 'on_approval' ? 'approved' : step.status}
                            label={step.reviewed && step.status === 'on_approval' ? 'Согласовано' : undefined}
                          />
                        ))}
                        {!item.my_step_statuses?.length && '—'}
                      </Stack>
                    </TableCell>
                  )}
                  {requestVisibility.planned && <TableCell>{money(item.summary?.planned_sum)}</TableCell>}
                  {requestVisibility.approved && <TableCell>{money(item.summary?.approved_sum ?? (item.status === 'cancelled' ? 0 : item.sum))}</TableCell>}
                  {requestVisibility.items_count && <TableCell>{item.summary?.items_count || 0}</TableCell>}
                  </>}
                </TableRow>
                </Fragment>
              );
            })}
            {visibleRequests.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleRequestColumns.length} align="center">Заявки по выбранным фильтрам не найдены</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Удалить черновик?"
        maxWidth="md"
        description={
          deleteTarget ? (
            <Stack spacing={1.5}>
              {deleteTargetRequest ? (
                <Typography variant="body2" color="text.secondary">
                  {deleteTargetRequest.unit_id ? `Подразделение заявки: ${formatUnitName(deleteTargetRequest.unit_id)}` : ''}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Загружается состав заявки...
                </Typography>
              )}
              {deletePreviewRows.length > 0 && (
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="flex-start">
                    <TableColumnTools
                      columns={deletePreviewColumns}
                      visibility={deletePreviewVisibility}
                      onToggleColumn={toggleDeletePreviewVisibility}
                      onResetColumns={resetDeletePreviewVisibility}
                      onResetFilters={resetDeletePreviewFilters}
                      hasActiveFilters={hasActiveDeletePreviewFilters}
                    />
                  </Stack>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {deletePreviewVisibility.kind && <TableCell sx={{ py: 0.75 }}>{renderDeletePreviewHeader('kind', 'Тип')}</TableCell>}
                        {deletePreviewVisibility.name && <TableCell sx={{ py: 0.75 }}>{renderDeletePreviewHeader('name', 'Статья / проект')}</TableCell>}
                        {deletePreviewVisibility.sum && <TableCell sx={{ py: 0.75 }} align="right">{renderDeletePreviewHeader('sum', 'План')}</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleDeletePreviewRows.map((row, index) => (
                        <TableRow key={`${row.kind}-${row.name}-${index}`}>
                          {deletePreviewVisibility.kind && <TableCell sx={{ py: 0.75 }}>{row.kind}</TableCell>}
                          {deletePreviewVisibility.name && <TableCell sx={{ py: 0.75 }}>{row.name}</TableCell>}
                          {deletePreviewVisibility.sum && (
                            <TableCell sx={{ py: 0.75 }} align="right">
                              {money(row.sum)}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      {visibleDeletePreviewRows.length === 0 && (
                        <TableRow>
                          <TableCell sx={{ py: 0.75 }} colSpan={visibleDeletePreviewColumns.length} align="center">
                            Ничего не найдено
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Stack>
              )}
            </Stack>
          ) : null
        }
        confirmLabel="Удалить черновик"
        confirmColor="error"
        pending={deleteRequest.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteRequest.mutate(deleteTarget.id)}
      />
      <RequestHistoryDrawer target={historyTarget} onClose={() => setHistoryTarget(null)} />
    </Stack>
  );
}

export default function RequestsPage({ user }: { user: User }) {
  const { data: units = [], isPending: unitsPending } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get<Unit[]>('/units')).data,
  });
  const isCfoResponsible = user.role === 'employee'
    && (user.unit_ids || []).some((unitId) => units.some((unit) => unit.id === unitId && unit.type === 'cfo'));
  const isReviewer = isCfoResponsible || ['admin', 'economist', 'approver', 'zgd'].includes(user.role);

  if (user.role === 'employee' && unitsPending) {
    return <PageSkeleton variant="table" label="Загрузка заявок" />;
  }

  if (isReviewer) {
    return (
      <Suspense fallback={<PageSkeleton variant="table" label="Загрузка реестра заявок" />}>
        <ApprovalRegister user={user} inRequestsPage />
      </Suspense>
    );
  }

  return <RequestsListPage user={user} />;
}
