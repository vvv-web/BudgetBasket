import { describe, expect, it } from 'vitest';
import type { ApprovalRegisterGroup, ApprovalRegisterRow } from '../../types';
import {
  buildRegisterControlRows,
  computeRegisterVisibility,
  filterRegisterGroups,
  adjustRegisterStatusFilterValues,
  REGISTRY_TABLE_COLUMN_DEFINITIONS,
  sortRegisterGroups,
  sortRegisterItems,
} from './registryTableColumns';
import { groupRegistryStatus, rowRegistryStatus } from './registryConfig';

const baseAggregates = {
  requested_sum: 100,
  approved_sum: 50,
  rejected_sum: 0,
  pending_sum: 50,
  difference: -50,
  total_rows: 2,
  approved_rows: 1,
  rejected_rows: 0,
  pending_rows: 1,
  requests_count: 1,
  modules_count: 1,
  aggregate_status: 'in_progress' as const,
  collecting_requests: 0,
  cfo_review_requests: 1,
  cfo_review_actionable_requests: 1,
  cfo_review_completable_requests: 0,
  in_approval_positions: 0,
  actionable_positions: 0,
};

function makeGroup(id: string, name: string, children: ApprovalRegisterGroup[] = []): ApprovalRegisterGroup {
  return {
    id,
    type: 'article',
    name,
    label: 'Статья',
    module_id: 'module-1',
    article_id: id,
    category_id: 'category-1',
    request_ids: ['request-1'],
    aggregates: baseAggregates,
    children,
    can_load_rows: false,
  };
}

function makeItem(id: string, name: string): ApprovalRegisterRow {
  return {
    id,
    request_id: 'request-1',
    request_status: 'on_review',
    budget_year: 2026,
    module_id: 'module-1',
    module_name: 'Модуль',
    cfo_id: 'cfo-1',
    cfo_name: 'ЦФО',
    category_id: 'category-1',
    category_name: 'Категория',
    article_id: 'article-1',
    article_name: 'Статья',
    kind: 'dds',
    name,
    justification: '',
    comment: '',
    files_count: 0,
    requested_sum: 10,
    approved_sum: 0,
    status: 'on_review',
    updated_at: '2026-08-07T10:00:00Z',
    is_collecting: false,
    is_cfo_review: true,
    is_cfo_review_actionable: true,
    position_id: null,
    is_in_approval: false,
    is_approval_actionable: false,
    approval_stage: null,
    frozen: false,
    fixed: false,
    analytics_1: '',
    analytics_2: '',
    analytics_3: '',
    analytics_4: '',
    analytics_5: '',
  };
}

describe('registryTableColumns', () => {
  it('sorts groups and items by structure ascending', () => {
    const groups = [makeGroup('article:b', 'Бета'), makeGroup('article:a', 'Альфа')];
    const sorted = sortRegisterGroups(groups, { column: 'structure', direction: 'asc' });
    expect(sorted.map((group) => group.name)).toEqual(['Альфа', 'Бета']);
  });

  it('filters groups by column visibility and keeps ancestors', () => {
    const child = makeGroup('article:child', 'Дочерняя');
    const parent = makeGroup('article:parent', 'Родитель', [child]);
    const groups = [parent];
    const rows = buildRegisterControlRows(groups, [{ item: makeItem('line-1', 'Нужная строка'), groupId: child.id }]);
    const { visibleGroupIds, visibleItemIds } = computeRegisterVisibility(groups, rows.filter((row) => row.kind === 'item'), true);
    expect(visibleItemIds?.has('line-1')).toBe(true);
    expect(visibleGroupIds?.has(parent.id)).toBe(true);
    expect(visibleGroupIds?.has(child.id)).toBe(true);
    const filtered = filterRegisterGroups(groups, visibleGroupIds);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].children).toHaveLength(1);
  });

  it('keeps loaded detail rows when a parent aggregate matches a filter', () => {
    const child = makeGroup('article:child', 'Дочерняя');
    const parent = makeGroup('article:parent', 'Родитель', [child]);
    const rows = buildRegisterControlRows([parent], [{ item: makeItem('line-1', 'Строка'), groupId: child.id }]);
    const parentRow = rows.find((row) => row.kind === 'group' && row.group.id === parent.id)!;
    const { visibleGroupIds, visibleItemIds } = computeRegisterVisibility([parent], [parentRow], true, rows);

    expect(visibleGroupIds?.has(child.id)).toBe(true);
    expect(visibleItemIds?.has('line-1')).toBe(true);
  });

  it('binds shared article categories to the matching CFO branch', () => {
    const categoryA = { ...makeGroup('/cfo:cfo-1/article:article-1/category:category-1', 'Категория'), type: 'category' as const, article_id: 'article-1', category_id: 'category-1', can_load_rows: true };
    const categoryB = { ...makeGroup('/cfo:cfo-2/article:article-1/category:category-1', 'Категория'), type: 'category' as const, article_id: 'article-1', category_id: 'category-1', can_load_rows: true };
    const articleA = { ...makeGroup('/cfo:cfo-1/article:article-1', 'Статья', [categoryA]), article_id: 'article-1' };
    const articleB = { ...makeGroup('/cfo:cfo-2/article:article-1', 'Статья', [categoryB]), article_id: 'article-1' };
    const cfoA = { ...makeGroup('/cfo:cfo-1', 'ЦФО 1', [articleA]), type: 'cfo' as const };
    const cfoB = { ...makeGroup('/cfo:cfo-2', 'ЦФО 2', [articleB]), type: 'cfo' as const };
    const item = { ...makeItem('line-2', 'Строка второго ЦФО'), cfo_id: 'cfo-2', cfo_name: 'ЦФО 2' };

    const rows = buildRegisterControlRows([cfoA, cfoB], [{ item, groupId: categoryA.id }]);
    const itemRow = rows.find((row) => row.kind === 'item')!;

    expect(itemRow.kind === 'item' && itemRow.groupId).toBe(categoryB.id);
    expect(itemRow.kind === 'item' && itemRow.groupPath.map((group) => group.id)).toEqual([
      cfoB.id,
      articleB.id,
      categoryB.id,
    ]);
  });

  it('keeps a category as the detail scope but includes its module in aggregates', () => {
    const module = { ...makeGroup('/cfo:cfo-1/article:article-1/category:category-1/module:module-1', 'Модуль'), type: 'module' as const, module_id: 'module-1' };
    const category = { ...makeGroup('/cfo:cfo-1/article:article-1/category:category-1', 'Категория', [module]), type: 'category' as const, article_id: 'article-1', category_id: 'category-1', can_load_rows: true };
    const article = { ...makeGroup('/cfo:cfo-1/article:article-1', 'Статья', [category]), article_id: 'article-1' };
    const cfo = { ...makeGroup('/cfo:cfo-1', 'ЦФО 1', [article]), type: 'cfo' as const };
    const item = { ...makeItem('line-1', 'Строка'), article_id: 'article-1' };

    const itemRow = buildRegisterControlRows([cfo], [{ item, groupId: category.id }]).find((row) => row.kind === 'item')!;

    expect(itemRow.kind === 'item' && itemRow.groupId).toBe(category.id);
    expect(itemRow.kind === 'item' && itemRow.groupPath.at(-1)?.id).toBe(module.id);
    const filtered = filterRegisterGroups([cfo], new Set([cfo.id, article.id, category.id, module.id]), itemRow.kind === 'item' ? [itemRow] : []);
    expect(filtered[0].children[0].children[0].children[0].aggregates.total_rows).toBe(1);
  });

  it('uses hierarchy values when combining structure and line filters', () => {
    const category = { ...makeGroup('/cfo:cfo-1/article:article-1/category:category-1', 'Категория'), type: 'category' as const, article_id: 'article-1', category_id: 'category-1', can_load_rows: true };
    const article = { ...makeGroup('/cfo:cfo-1/article:article-1', 'Статья', [category]), article_id: 'article-1' };
    const cfo = { ...makeGroup('/cfo:cfo-1', 'ЦФО 1', [article]), type: 'cfo' as const };
    const item = { ...makeItem('line-1', 'Строка'), article_id: 'article-1' };
    const itemRow = buildRegisterControlRows([cfo], [{ item, groupId: category.id }]).find((row) => row.kind === 'item')!;
    const structure = REGISTRY_TABLE_COLUMN_DEFINITIONS.find((column) => column.id === 'structure')!;

    expect(structure.getFilterValue?.(itemRow)).toEqual([
      'Строка',
      'ЦФО 1 · Статья',
      'Статья · Статья',
      'Категория · Статья',
    ]);
  });

  it('keeps group and row statuses as separate filter values', () => {
    const child = { ...makeGroup('article:child', 'Р”РѕС‡РµСЂРЅСЏСЏ'), can_load_rows: true };
    const parent = makeGroup('article:parent', 'Р РѕРґРёС‚РµР»СЊ', [child]);
    const rows = buildRegisterControlRows([parent], [{ item: makeItem('line-1', 'РЎС‚СЂРѕРєР°'), groupId: child.id }]);
    const itemRow = rows.find((row) => row.kind === 'item')!;
    const groupRow = rows.find((row) => row.kind === 'group' && row.group.id === parent.id)!;
    const status = REGISTRY_TABLE_COLUMN_DEFINITIONS.find((column) => column.id === 'status')!;

    expect(status.getFilterValue?.(groupRow)).toMatch(/^group:/);
    expect(status.getFilterValue?.(itemRow)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^row:/),
      expect.stringMatching(/^group:/),
    ]));
  });

  it('closes a line status when a selected group status covers all lines with it', () => {
    const approvedGroup = {
      ...makeGroup('article:approved', 'РЎРѕРіР»Р°СЃРѕРІР°РЅРЅР°СЏ'),
      can_load_rows: true,
      aggregates: {
        ...baseAggregates,
        total_rows: 1,
        approved_rows: 1,
        pending_rows: 0,
        cfo_review_requests: 0,
        cfo_review_actionable_requests: 0,
        aggregate_status: 'approved' as const,
      },
    };
    const item = { ...makeItem('line-approved', 'РЎС‚СЂРѕРєР°'), status: 'approved' as const, is_cfo_review: false, is_cfo_review_actionable: false };
    const rows = buildRegisterControlRows([approvedGroup], [{ item, groupId: approvedGroup.id }]);
    const groupStatus = `group:${groupRegistryStatus(approvedGroup.aggregates).label}`;
    const rowStatus = `row:${rowRegistryStatus(item).label}`;
    const availableValues = [groupStatus, rowStatus];

    expect(adjustRegisterStatusFilterValues(rows, groupStatus, [rowStatus], availableValues)).toEqual([]);

    const mixedGroup = { ...makeGroup('article:mixed', 'РЎРјРµС€Р°РЅРЅР°СЏ'), can_load_rows: true };
    const mixedItem = { ...makeItem('line-approved-elsewhere', 'РЎС‚СЂРѕРєР° 2'), status: 'approved' as const, is_cfo_review: false, is_cfo_review_actionable: false };
    const mixedRows = buildRegisterControlRows(
      [approvedGroup, mixedGroup],
      [{ item, groupId: approvedGroup.id }, { item: mixedItem, groupId: mixedGroup.id }],
    );
    const mixedAvailableValues = [
      groupStatus,
      `group:${groupRegistryStatus(mixedGroup.aggregates).label}`,
      rowStatus,
    ];
    expect(adjustRegisterStatusFilterValues(mixedRows, groupStatus, mixedAvailableValues.slice(1), mixedAvailableValues)).toContain(rowStatus);
  });

  it('recalculates every visible aggregate from the same detail rows', () => {
    const child = { ...makeGroup('article:child', 'Дочерняя'), can_load_rows: true };
    const parent = {
      ...makeGroup('article:parent', 'Родитель', [child]),
      analytics: {
        can_edit: true,
        fields: { analytics_1: { value: '', mixed: true } },
      },
    };
    const item = makeItem('line-1', 'Строка');
    item.requested_sum = 10;
    item.analytics_1 = 'Только видимое значение';
    const itemRow = buildRegisterControlRows([parent], [{ item, groupId: child.id }]).find((row) => row.kind === 'item')!;
    const visibleIds = new Set([parent.id, child.id]);
    const filtered = filterRegisterGroups([parent], visibleIds, itemRow.kind === 'item' ? [itemRow] : []);

    expect(filtered[0].aggregates.total_rows).toBe(1);
    expect(filtered[0].aggregates.requested_sum).toBe(10);
    expect(filtered[0].source_aggregates?.total_rows).toBe(2);
    expect(filtered[0].children[0].aggregates.requested_sum).toBe(10);
    expect(filtered[0].analytics?.fields.analytics_1).toEqual({ value: 'Только видимое значение', mixed: false });
    expect(filtered[0].analytics?.can_edit).toBe(false);
  });

  it('sorts item rows by requested sum', () => {
    const items = [makeItem('1', 'A'), makeItem('2', 'B')];
    items[0].requested_sum = 20;
    items[1].requested_sum = 5;
    const sorted = sortRegisterItems(items, { column: 'requested', direction: 'asc' });
    expect(sorted.map((item) => item.id)).toEqual(['2', '1']);
  });
});
