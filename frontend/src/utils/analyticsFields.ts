export const ANALYTICS_FIELD_KEYS = [
  'analytics_1',
  'analytics_2',
  'analytics_3',
  'analytics_4',
  'analytics_5',
] as const;

export type AnalyticsFieldKey = typeof ANALYTICS_FIELD_KEYS[number];

export const ANALYTICS_FIELD_LABELS: Record<AnalyticsFieldKey, string> = {
  analytics_1: 'Аналитика 1',
  analytics_2: 'Аналитика 2',
  analytics_3: 'Аналитика 3',
  analytics_4: 'Аналитика 4',
  analytics_5: 'Аналитика 5',
};

export const EMPTY_ANALYTICS_FILTERS = ANALYTICS_FIELD_KEYS.reduce((result, key) => {
  result[key] = '';
  return result;
}, {} as Record<AnalyticsFieldKey, string>);

export function analyticsFieldValue(item: Partial<Record<AnalyticsFieldKey, string | null | undefined>>, key: AnalyticsFieldKey) {
  return (item[key] || '').trim();
}

export function canEditItemAnalytics(item: {
  status?: string;
  frozen?: boolean;
  fixed?: boolean;
  status_context?: { editability?: { can_edit_analytics?: boolean } };
}): boolean {
  if (item.status_context?.editability) {
    return item.status_context.editability.can_edit_analytics ?? false;
  }
  return item.status !== 'deleted' && !item.frozen && !item.fixed;
}

export function buildRegisterFilterParams(
  filters: {
  search: string;
  flow?: '' | 'expense' | 'income';
  status: string;
    budgetYear: string;
    cfoId?: string;
    articleId?: string;
    requestStatus?: string;
    frozen?: '' | 'frozen' | 'fixed';
    positionedOnly?: boolean;
  } & Record<AnalyticsFieldKey, string>,
  extras?: Record<string, unknown>,
) {
  const params: Record<string, unknown> = {
    status: filters.status || undefined,
    budget_year: filters.budgetYear || undefined,
    search: filters.search || undefined,
    cfo_id: filters.cfoId || undefined,
    article_id: filters.articleId || undefined,
    request_status: filters.requestStatus || undefined,
    frozen: filters.frozen || undefined,
    positioned_only: filters.positionedOnly || undefined,
    is_income: filters.flow === 'income' ? true : filters.flow === 'expense' ? false : undefined,
    ...extras,
  };
  ANALYTICS_FIELD_KEYS.forEach((key) => {
    if (filters[key]) params[key] = filters[key];
  });
  return params;
}
