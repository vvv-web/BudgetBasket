import type { ApprovalRegisterGroup, ApprovalRegisterRow } from '../../types';
import { ANALYTICS_FIELD_KEYS, type AnalyticsFieldKey } from '../../utils/analyticsFields';
import { money } from '../../utils/labels';
import type { TableColumnDefinition, TableSortState } from '../../utils/tableColumns';
import {
  groupRegistryStatus,
  groupPreviousStepSummary,
  groupYourStepSummary,
  rowRegistryStatus,
  type RegistryColumnId,
} from './registryConfig';

export type RegisterControlRow =
  | { kind: 'group'; group: ApprovalRegisterGroup }
  | { kind: 'item'; item: ApprovalRegisterRow; groupId: string; groupPath: ApprovalRegisterGroup[] };

/**
 * Group and line statuses are exposed as separate filter values.  A group
 * value also matches every line in its branch, so leaving the corresponding
 * line value selected would make a closed group status appear to have no
 * effect. Remove the line value when the group value is removed and it covers
 * every line carrying that line status.
 */
export function adjustRegisterStatusFilterValues(
  rows: RegisterControlRow[],
  optionValue: string,
  nextValues: string[],
  availableValues: string[],
) {
  if (!optionValue.startsWith('group:')) return nextValues;

  const coveredItemIds = new Set(
    rows
      .filter((row): row is Extract<RegisterControlRow, { kind: 'item' }> => row.kind === 'item')
      .filter((row) => row.groupPath.some((group) => `group:${groupRegistryStatus(group.aggregates).label}` === optionValue))
      .map((row) => row.item.id),
  );
  if (!coveredItemIds.size) return nextValues;

  const itemIdsByStatus = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (row.kind !== 'item') return;
    const statusValue = `row:${rowRegistryStatus(row.item).label}`;
    const itemIds = itemIdsByStatus.get(statusValue) || new Set<string>();
    itemIds.add(row.item.id);
    itemIdsByStatus.set(statusValue, itemIds);
  });

  const resultingValues = new Set(nextValues);
  // Re-selecting a group must not silently undo an independently selected
  // line-status filter; the required coupling is removal of covered lines.
  if (resultingValues.has(optionValue)) return nextValues;
  itemIdsByStatus.forEach((itemIds, rowStatusValue) => {
    if (!itemIds.size || ![...itemIds].every((itemId) => coveredItemIds.has(itemId))) return;
    if (!availableValues.includes(rowStatusValue)) return;
    resultingValues.delete(rowStatusValue);
  });
  return [...resultingValues];
}

export const REGISTRY_COLUMN_MIN_WIDTHS: Record<RegistryColumnId, number> = {
  select: 40,
  structure: 220,
  requested: 100,
  approved: 100,
  rejected: 100,
  previous_step: 150,
  your_step: 190,
  status: 180,
  actions: 72,
  justification: 160,
  comment: 130,
  files: 72,
  ...ANALYTICS_FIELD_KEYS.reduce((result, key) => {
    result[key] = 120;
    return result;
  }, {} as Record<AnalyticsFieldKey, number>),
};

function groupStructureLabel(group: ApprovalRegisterGroup) {
  return `${group.name} · ${group.label}`;
}

function groupAnalyticsValue(group: ApprovalRegisterGroup, key: AnalyticsFieldKey) {
  const field = group.analytics?.fields[key];
  if (!field) return '';
  if (field.mixed) return 'Разные значения';
  return field.value;
}

function contextualFilterValues(
  row: RegisterControlRow,
  itemValue: unknown,
  groupValue: (group: ApprovalRegisterGroup) => unknown,
) {
  if (row.kind === 'group') return groupValue(row.group);
  return [itemValue, ...row.groupPath.map(groupValue)];
}

function itemApprovedDisplayValue(item: ApprovalRegisterRow) {
  const previous = item.status_context?.previous_step;
  if (previous?.amount != null) return money(previous.amount);
  return previous?.label || money(item.approved_sum);
}

function compareSortValues(
  left: string | number | boolean | null | undefined,
  right: string | number | boolean | null | undefined,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' });
}

export const REGISTRY_TABLE_COLUMN_DEFINITIONS: TableColumnDefinition<RegisterControlRow, RegistryColumnId>[] = [
  { id: 'select', label: '', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  {
    id: 'structure',
    label: 'Структура',
    getValue: (row) => (row.kind === 'group' ? groupStructureLabel(row.group) : row.item.name || '—'),
    getFilterValue: (row) => contextualFilterValues(row, row.kind === 'item' ? row.item.name || '—' : '', groupStructureLabel),
    getSortValue: (row) => (row.kind === 'group' ? row.group.name : row.item.name || ''),
  },
  {
    id: 'requested',
    label: 'План, ₽',
    getValue: (row) => money(row.kind === 'group' ? row.group.aggregates.requested_sum : row.item.requested_sum),
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item' ? money(row.item.requested_sum) : '',
      (group) => money(group.aggregates.requested_sum),
    ),
    getSortValue: (row) => (row.kind === 'group' ? row.group.aggregates.requested_sum : row.item.requested_sum),
  },
  {
    id: 'approved',
    label: 'Факт, ₽',
    getValue: (row) => {
      if (row.kind === 'group') return money(row.group.aggregates.approved_sum);
      return itemApprovedDisplayValue(row.item);
    },
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item' ? itemApprovedDisplayValue(row.item) : '',
      (group) => money(group.aggregates.approved_sum),
    ),
    getSortValue: (row) => {
      if (row.kind === 'group') return row.group.aggregates.approved_sum;
      const previous = row.item.status_context?.previous_step;
      if (previous?.amount != null) return previous.amount;
      return row.item.approved_sum;
    },
  },
  {
    id: 'rejected',
    label: 'Корректировка, ₽',
    getValue: (row) => money(row.kind === 'group' ? row.group.aggregates.difference : row.item.approved_sum - row.item.requested_sum),
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item' ? money(row.item.approved_sum - row.item.requested_sum) : '',
      (group) => money(group.aggregates.difference),
    ),
    getSortValue: (row) => (row.kind === 'group' ? row.group.aggregates.difference : row.item.approved_sum - row.item.requested_sum),
  },
  {
    id: 'previous_step',
    label: 'Предыдущий шаг',
    getValue: (row) => (
      row.kind === 'group'
        ? groupPreviousStepSummary(row.group.aggregates)
        : row.item.status_context?.previous_step?.label || '—'
    ),
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item' ? row.item.status_context?.previous_step?.label || '—' : '',
      (group) => groupPreviousStepSummary(group.aggregates),
    ),
    getSortValue: (row) => (
      row.kind === 'group'
        ? groupPreviousStepSummary(row.group.aggregates)
        : row.item.status_context?.previous_step?.label || ''
    ),
  },
  {
    id: 'your_step',
    label: 'Ваше решение',
    getValue: (row) => {
      if (row.kind === 'group') return groupYourStepSummary(row.group.aggregates);
      const your = row.item.status_context?.your_step;
      if (your?.amount != null) return `${money(your.amount)} · ${your.label}`;
      return your?.label || '—';
    },
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item'
        ? row.item.status_context?.your_step?.label || '—'
        : '',
      (group) => groupYourStepSummary(group.aggregates),
    ),
    getSortValue: (row) => (
      row.kind === 'group'
        ? groupYourStepSummary(row.group.aggregates)
        : row.item.status_context?.your_step?.label || ''
    ),
  },
  {
    id: 'status',
    label: 'Статус',
    getValue: (row) => (
      row.kind === 'group'
        ? groupRegistryStatus(row.group.aggregates).label
        : rowRegistryStatus(row.item).label
    ),
    getFilterValue: (row) => contextualFilterValues(
      row,
      row.kind === 'item' ? `row:${rowRegistryStatus(row.item).label}` : '',
      (group) => `group:${groupRegistryStatus(group.aggregates).label}`,
    ),
    getSortValue: (row) => (
      row.kind === 'group'
        ? row.group.aggregates.aggregate_status
        : row.item.status
    ),
  },
  {
    id: 'justification',
    label: 'Обоснование',
    getValue: (row) => (row.kind === 'group' ? '—' : row.item.justification || '—'),
    getSortValue: (row) => (row.kind === 'group' ? '' : row.item.justification || ''),
  },
  {
    id: 'comment',
    label: 'Комментарий',
    getValue: (row) => (row.kind === 'group' ? '—' : row.item.comment || '—'),
    getSortValue: (row) => (row.kind === 'group' ? '' : row.item.comment || ''),
  },
  {
    id: 'files',
    label: 'Файлы',
    sortable: false,
    getValue: (row) => (row.kind === 'group' ? '—' : String(row.item.files_count || '—')),
    getSortValue: (row) => (row.kind === 'group' ? -1 : row.item.files_count || 0),
  },
  { id: 'actions', label: 'Действия', sortable: false, filterable: false, hideable: false, getValue: () => '' },
  ...ANALYTICS_FIELD_KEYS.map((key) => ({
    id: key,
    label: `Аналитика ${key.slice(-1)}`,
    defaultVisible: false,
    getValue: (row: RegisterControlRow) => (
      row.kind === 'group' ? groupAnalyticsValue(row.group, key) || '—' : row.item[key] || '—'
    ),
    getFilterValue: (row: RegisterControlRow) => contextualFilterValues(
      row,
      row.kind === 'item' ? row.item[key] || '—' : '',
      (group) => groupAnalyticsValue(group, key) || '—',
    ),
    getSortValue: (row: RegisterControlRow) => (
      row.kind === 'group' ? groupAnalyticsValue(row.group, key) : row.item[key] || ''
    ),
  })),
];

const definitionsById = new Map(REGISTRY_TABLE_COLUMN_DEFINITIONS.map((column) => [column.id, column]));

export function flattenRegisterGroups(groups: ApprovalRegisterGroup[]): ApprovalRegisterGroup[] {
  return groups.flatMap((group) => [group, ...flattenRegisterGroups(group.children)]);
}

export function buildRegisterControlRows(
  groups: ApprovalRegisterGroup[],
  loadedItems: ReadonlyArray<{ item: ApprovalRegisterRow; groupId: string }>,
): RegisterControlRow[] {
  const rows: RegisterControlRow[] = flattenRegisterGroups(groups).map((group) => ({ kind: 'group', group }));
  const pathsById = new Map<string, ApprovalRegisterGroup[]>();
  const groupPaths: ApprovalRegisterGroup[][] = [];
  const visit = (nodes: ApprovalRegisterGroup[], path: ApprovalRegisterGroup[] = []) => {
    nodes.forEach((group) => {
      const nextPath = [...path, group];
      pathsById.set(group.id, nextPath);
      groupPaths.push(nextPath);
      visit(group.children, nextPath);
    });
  };
  visit(groups);

  const entityId = (group: ApprovalRegisterGroup) => {
    if (group.type === 'article') return group.article_id;
    if (group.type === 'category') return group.category_id;
    if (group.type === 'module') return group.module_id;
    const prefix = `${group.type}:`;
    const segment = group.id.split('/').find((part) => part.startsWith(prefix));
    return segment?.slice(prefix.length) || '';
  };
  const pathMatchesItem = (path: ApprovalRegisterGroup[], item: ApprovalRegisterRow) => path.every((group) => {
    if (group.scope) {
      return Object.entries(group.scope).every(([key, value]) => (
        String(item[key as keyof ApprovalRegisterRow] || '') === value
      ));
    }
    const id = entityId(group);
    if (group.type === 'cfo') return id === item.cfo_id;
    if (group.type === 'article') return id === item.article_id;
    if (group.type === 'category') return id === item.category_id;
    if (group.type === 'module') return id === item.module_id;
    if (ANALYTICS_FIELD_KEYS.includes(group.type as AnalyticsFieldKey)) {
      return String(item[group.type as AnalyticsFieldKey] || '') === group.group_value;
    }
    return group.type !== 'request' || id === item.request_id;
  });

  loadedItems.forEach(({ item, groupId }) => {
    const suppliedPath = pathsById.get(groupId);
    const groupPath = groupPaths
      .filter((path) => pathMatchesItem(path, item))
      .sort((left, right) => right.length - left.length)[0]
      || suppliedPath
      || [];
    // A category in the CFO view loads details itself, but its module children
    // still need to participate in filtered aggregates and statuses.
    const detailGroup = [...groupPath].reverse().find((group) => group.can_load_rows);
    rows.push({ kind: 'item', item, groupId: detailGroup?.id || groupPath.at(-1)?.id || groupId, groupPath });
  });
  return rows;
}

export function computeRegisterVisibility(
  groups: ApprovalRegisterGroup[],
  filteredRows: RegisterControlRow[],
  hasColumnFilters: boolean,
  allRows: RegisterControlRow[] = filteredRows,
) {
  if (!hasColumnFilters) {
    return { visibleGroupIds: null as Set<string> | null, visibleItemIds: null as Set<string> | null };
  }

  const visibleGroupIds = new Set<string>();
  const visibleItemIds = new Set<string>();
  const parentById = new Map<string, string | undefined>();
  const groupById = new Map<string, ApprovalRegisterGroup>();

  const walkParents = (nodes: ApprovalRegisterGroup[], parentId?: string) => {
    nodes.forEach((group) => {
      parentById.set(group.id, parentId);
      groupById.set(group.id, group);
      walkParents(group.children, group.id);
    });
  };
  walkParents(groups);

  const includeAncestors = (groupId: string) => {
    let current: string | undefined = groupId;
    while (current) {
      visibleGroupIds.add(current);
      current = parentById.get(current);
    }
  };

  const includeDescendants = (groupId: string) => {
    const group = groupById.get(groupId);
    if (!group) return;
    visibleGroupIds.add(group.id);
    group.children.forEach((child) => includeDescendants(child.id));
  };

  filteredRows.forEach((row) => {
    if (row.kind === 'group') {
      includeAncestors(row.group.id);
      includeDescendants(row.group.id);
      // A matching aggregate row represents its whole expanded branch.
      // Keep loaded details visible instead of showing an empty branch.
      allRows.forEach((candidate) => {
        if (candidate.kind === 'item' && candidate.groupPath.some((group) => group.id === row.group.id)) {
          visibleItemIds.add(candidate.item.id);
        }
      });
      return;
    }
    visibleItemIds.add(row.item.id);
    includeAncestors(row.groupId);
  });

  return { visibleGroupIds, visibleItemIds };
}

export function filterRegisterGroups(
  groups: ApprovalRegisterGroup[],
  visibleGroupIds: Set<string> | null,
  visibleItems: Extract<RegisterControlRow, { kind: 'item' }>[] = [],
): ApprovalRegisterGroup[] {
  if (!visibleGroupIds) return groups;
  return groups.flatMap((group) => {
    const children = filterRegisterGroups(group.children, visibleGroupIds, visibleItems);
    if (!visibleGroupIds.has(group.id) && !children.length) return [];
    const rows = visibleItems
      .filter((row) => row.groupPath.some((entry) => entry.id === group.id))
      .map((row) => row.item);
    const analytics = group.analytics ? {
      can_edit: group.analytics.can_edit && rows.length === group.aggregates.total_rows,
      fields: ANALYTICS_FIELD_KEYS.reduce((fields, key) => {
        const values = [...new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))];
        fields[key] = {
          value: values.length === 1 ? values[0] : '',
          mixed: values.length > 1,
        };
        return fields;
      }, {} as Record<AnalyticsFieldKey, { value: string; mixed: boolean }>),
    } : undefined;
    return [{
      ...group,
      source_aggregates: group.source_aggregates || group.aggregates,
      aggregates: aggregateRegisterRows(group.aggregates, rows),
      analytics,
      children,
    }];
  });
}

export function aggregateRegisterRows(base: ApprovalRegisterGroup['aggregates'], rows: ApprovalRegisterRow[]): ApprovalRegisterGroup['aggregates'] {
  const approvedRows = rows.filter((row) => row.status === 'approved' || row.status === 'approved_with_changes');
  const rejectedRows = rows.filter((row) => row.status === 'rejected');
  const pendingRows = rows.filter((row) => !approvedRows.includes(row) && !rejectedRows.includes(row));
  const requestedSum = rows.reduce((sum, row) => sum + Number(row.requested_sum || 0), 0);
  const approvedSum = approvedRows.reduce((sum, row) => sum + Number(row.approved_sum || 0), 0);
  const countDistinct = (values: Array<string | null | undefined>) => new Set(values.filter(Boolean)).size;
  const aggregateStatus: ApprovalRegisterGroup['aggregates']['aggregate_status'] = !rows.length
    ? 'no_data'
    : approvedRows.length === rows.length
      ? 'approved'
      : rejectedRows.length === rows.length
        ? 'rejected'
        : !pendingRows.length
          ? 'partially_approved'
          : !approvedRows.length && !rejectedRows.length
            ? 'on_review'
            : 'in_progress';
  return {
    ...base,
    requested_sum: requestedSum,
    approved_sum: approvedSum,
    rejected_sum: rejectedRows.reduce((sum, row) => sum + Number(row.requested_sum || 0), 0),
    pending_sum: pendingRows.reduce((sum, row) => sum + Number(row.requested_sum || 0), 0),
    difference: approvedSum - requestedSum,
    total_rows: rows.length,
    approved_rows: approvedRows.length,
    rejected_rows: rejectedRows.length,
    revision_rows: rows.filter((row) => row.is_revision).length,
    cfo_revision_rows: rows.filter((row) => row.is_cfo_revision).length,
    pending_rows: pendingRows.length,
    requests_count: countDistinct(rows.map((row) => row.request_id)),
    modules_count: countDistinct(rows.map((row) => row.module_id)),
    aggregate_status: aggregateStatus,
    collecting_requests: countDistinct(rows.filter((row) => row.is_collecting).map((row) => row.request_id)),
    cfo_review_requests: countDistinct(rows.filter((row) => row.is_cfo_review).map((row) => row.request_id)),
    cfo_review_actionable_requests: countDistinct(rows.filter((row) => row.is_cfo_review_actionable).map((row) => row.request_id)),
    cfo_review_completable_requests: countDistinct(rows.filter((row) => row.is_cfo_review_completable).map((row) => row.request_id)),
    in_approval_positions: countDistinct(rows.filter((row) => row.is_in_approval).map((row) => row.position_id)),
    actionable_positions: countDistinct(rows.filter((row) => row.is_position_actionable).map((row) => row.position_id)),
    submission_positions: countDistinct(rows.filter((row) => row.is_position_submission_actionable).map((row) => row.position_id)),
    economist_completion_positions: countDistinct(rows.filter((row) => row.is_economist_completion_actionable).map((row) => row.position_id)),
    workflow_ready_positions: countDistinct(rows.filter((row) => row.is_workflow_submission_actionable).map((row) => row.position_id)),
    fixed_rows: rows.filter((row) => row.fixed).length,
    zgd_lock_positions: countDistinct(rows.filter((row) => row.is_zgd_lock_actionable).map((row) => row.position_id)),
  };
}

export function sortRegisterGroups(
  groups: ApprovalRegisterGroup[],
  sort: TableSortState<RegistryColumnId> | null,
): ApprovalRegisterGroup[] {
  if (!sort) return groups;
  const column = definitionsById.get(sort.column);
  if (!column || column.sortable === false) return groups;

  const sorted = [...groups].sort((left, right) => {
    const leftRow: RegisterControlRow = { kind: 'group', group: left };
    const rightRow: RegisterControlRow = { kind: 'group', group: right };
    const leftValue = column.getSortValue ? column.getSortValue(leftRow) : column.getValue(leftRow);
    const rightValue = column.getSortValue ? column.getSortValue(rightRow) : column.getValue(rightRow);
    const result = compareSortValues(
      leftValue as string | number | boolean | null | undefined,
      rightValue as string | number | boolean | null | undefined,
    );
    return sort.direction === 'asc' ? result : -result;
  });

  return sorted.map((group) => ({
    ...group,
    children: sortRegisterGroups(group.children, sort),
  }));
}

export function sortRegisterItems(
  items: ApprovalRegisterRow[],
  sort: TableSortState<RegistryColumnId> | null,
): ApprovalRegisterRow[] {
  if (!sort) return items;
  const column = definitionsById.get(sort.column);
  if (!column || column.sortable === false) return items;

  return [...items].sort((left, right) => {
    const leftRow: RegisterControlRow = { kind: 'item', item: left, groupId: '', groupPath: [] };
    const rightRow: RegisterControlRow = { kind: 'item', item: right, groupId: '', groupPath: [] };
    const leftValue = column.getSortValue ? column.getSortValue(leftRow) : column.getValue(leftRow);
    const rightValue = column.getSortValue ? column.getSortValue(rightRow) : column.getValue(rightRow);
    const result = compareSortValues(
      leftValue as string | number | boolean | null | undefined,
      rightValue as string | number | boolean | null | undefined,
    );
    return sort.direction === 'asc' ? result : -result;
  });
}

export function getRegisterAutoFitValues(
  rows: RegisterControlRow[],
  columnId: RegistryColumnId,
) {
  const column = definitionsById.get(columnId);
  if (!column) return [];
  return rows.map((row) => String(column.getValue(row)));
}
