import type { ItemStatus, RequestLog, RequestStatus, StepStatus } from '../../types';
import { ANALYTICS_FIELD_LABELS } from '../../utils/analyticsFields';
import { itemStatusLabels, requestStatusLabels, stepStatusLabels } from '../../utils/labels';
import { money } from '../../utils/labels';

export function historyStatusLabel(status: string): string {
  return itemStatusLabels[status as ItemStatus]
    || stepStatusLabels[status as StepStatus]
    || requestStatusLabels[status as RequestStatus]
    || status;
}

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
  request_created: 'Заявка создана',
  request_submitted_to_cfo: 'Заявка отправлена на проверку ЦФО',
  request_cancelled: 'Заявка отменена',
  request_restored: 'Заявка восстановлена из отмены',
  cfo_request_review_completed: 'Проверка ЦФО завершена',
  cfo_items_returned_for_revision: 'Строки заявки возвращены на доработку',
  request_revision_resubmitted_to_cfo: 'Доработанные строки повторно отправлены в ЦФО',
  position_route_repaired_from_audit: 'Маршрут позиции восстановлен по журналу',
  line_created: 'Создана строка заявки',
  line_updated: 'Изменена строка заявки',
  line_deleted: 'Удалена строка заявки',
  cfo_item_decided: 'Решение по строке на этапе ЦФО',
  economist_item_decided: 'Решение экономиста по строке',
  item_returned_for_revision: 'Строка возвращена на доработку',
  file_attached: 'Добавлен файл',
  file_deleted: 'Удалён файл',
  file_sanitized: 'Файл обработан антивирусом',
  chat_message_sent: 'Отправлено сообщение в чат',
  system_message_sent: 'Отправлено системное сообщение в чат',
  position_sent_to_economist: 'Позиция передана экономисту',
  economist_review_completed: 'Экономист завершил проверку позиции',
  position_frozen_and_forwarded: 'Позиция зафиксирована и передана дальше',
  position_items_frozen: 'Строки позиции зафиксированы',
  position_items_approved_at_step: 'Согласующий согласовал строку',
  position_unfrozen: 'Фиксация позиции снята',
  position_returned: 'Позиция возвращена на доработку',
  fixed_items_reopened: 'Зафиксированные строки открыты повторно',
  position_comment_added: 'Добавлен комментарий к позиции',
  position_moved_to_shared_economist_step: 'Позиция переведена на общий этап экономиста',
  position_moved_to_economist_step: 'Позиция переведена на этап экономиста',
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

const historyFieldLabels: Record<string, string> = {
  name: 'Наименование',
  justification: 'Обоснование',
  sum_plan: 'Плановая сумма',
  sum_fact: 'Утверждённая сумма',
  status: 'Статус',
  reviewer_decision: 'Решение согласующего',
  comment: 'Комментарий',
  frozen: 'Фиксация бюджета',
  fixed: 'Финальная фиксация ЗГД',
  is_income: 'Тип строки',
  dds_id: 'Статья ДДС',
  invest_id: 'Инвест-проект',
  month_plans: 'Помесячный план',
  text: 'Текст сообщения',
  ...ANALYTICS_FIELD_LABELS,
};

// Logs deliberately retain the full entity snapshot for audit purposes.  The
// history shown to a person is a separate, public projection: only fields that
// have a business label may be rendered.  This prevents a newly added storage
// field (including identifiers) from leaking into UI or exports by default.
const publicHistoryFields = new Set(Object.keys(historyFieldLabels));

const approvalOnlyActions = new Set([
  'request_submitted_to_cfo',
  'cfo_request_review_completed',
  'cfo_items_returned_for_revision',
  'request_revision_resubmitted_to_cfo',
  'position_route_repaired_from_audit',
  'cfo_item_decided',
  'economist_item_decided',
]);

export function historyActionLabel(action: string) {
  if (action.startsWith('approval_')) {
    return approvalRouteActionLabels[action] || 'Состояние согласования изменено';
  }
  return historyActionLabels[action] || 'Данные заявки изменены';
}

export function historyActorName(actor: RequestLog['user']) {
  if (!actor) return 'Неизвестный пользователь';
  const profile = actor.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || actor.login;
}

const monthLabels = ['янв.', 'фев.', 'мар.', 'апр.', 'май', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];

function historyValue(value: unknown, field: string, entity: string, action: string) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') {
    if (field === 'is_income') return value ? 'Доход' : 'Расход';
    return value ? 'Да' : 'Нет';
  }
  if (field === 'sum_plan' || field === 'sum_fact') return money(Number(value));
  if (field === 'status' && typeof value === 'string') {
    return historyStatusLabel(value);
  }
  if (field === 'reviewer_decision' && typeof value === 'string') {
    if (value === 'pending') return 'Ожидает решения';
    if (value === 'approved') return 'Согласовано';
    return historyStatusLabel(value);
  }
  if (field === 'frozen') return value ? 'Зафиксирован' : 'Разморожен';
  if (Array.isArray(value)) {
    if (field === 'month_plans') {
      const plans = value
        .filter((plan): plan is { month: unknown; sum_plan: unknown } => Boolean(plan) && typeof plan === 'object' && 'month' in plan && 'sum_plan' in plan)
        .map((plan) => {
          const month = Number(plan.month);
          const label = monthLabels[month - 1] || `Месяц ${month}`;
          return `${label}: ${money(Number(plan.sum_plan))}`;
        });
      return plans.length ? plans.join('; ') : '—';
    }
    return value.length ? `Указано значений: ${value.length}` : '—';
  }
  if (typeof value === 'object') {
    if ('name' in value && typeof value.name === 'string' && value.name.trim()) return value.name;
    return 'Указано значение';
  }
  return String(value);
}

export type HistoryChange = { field: string; from: string; to: string };

export function historyChanges(entry: RequestLog): HistoryChange[] {
  const changes = entry.log.action === 'position_items_approved_at_step'
    && !entry.log.changes?.reviewer_decision
    ? {
      ...(entry.log.changes || {}),
      reviewer_decision: { from: 'pending', to: 'approved' },
    }
    : (entry.log.changes || {});
  return Object.entries(changes)
    .filter(([field]) => publicHistoryFields.has(field))
    .map(([field, change]) => ({
      field: historyFieldLabels[field],
      from: historyValue(change.from, field, entry.log.entity, entry.log.action),
      to: historyValue(change.to, field, entry.log.entity, entry.log.action),
    }));
}

export function isApprovalHistoryEntry(entry: RequestLog) {
  if (entry.source === 'cfo_position') return true;
  if (entry.log.action.startsWith('approval_')) return true;
  return approvalOnlyActions.has(entry.log.action);
}

export function splitRequestLogs(logs: RequestLog[]) {
  const content: RequestLog[] = [];
  const approval: RequestLog[] = [];
  logs.forEach((entry) => {
    if (isApprovalHistoryEntry(entry)) approval.push(entry);
    else content.push(entry);
  });
  return { content, approval };
}

export type HistoryEventGroup = {
  id: string;
  entries: RequestLog[];
  grouped: boolean;
};

/**
 * Register actions can affect several CFO positions at once.  Such records
 * have one event_id; show them as one operation while keeping its composition
 * available in the expanded details.
 */
export function groupHistoryEntries(logs: RequestLog[]): HistoryEventGroup[] {
  const groups = new Map<string, RequestLog[]>();
  const order: string[] = [];

  logs.forEach((entry) => {
    const eventId = entry.source === 'cfo_position' ? entry.log.event_id : undefined;
    // Line-by-line reviewer calls may be persisted as separate events even
    // when one bulk action selected all lines. Group calls made by the same
    // reviewer for the same position in the same second, preserving the
    // operation's comment and step as part of the grouping key.
    const reviewerLineGroup = entry.source === 'cfo_position'
      && entry.log.action === 'position_items_approved_at_step'
      // Before bulk event ids were sent by the register, legacy records have
      // no req_item_id. Their timestamps are the only available batch marker;
      // use the minute and reviewer/step/comment to keep that history intact.
      && !entry.log.req_item_id
      ? `legacy-reviewer:${entry.user?.id || 'unknown'}:${entry.log.step_id || ''}:${entry.log.comment || ''}:${entry.created_at.slice(0, 16)}`
      : undefined;
    // Older group operations were written before event_id was introduced.
    // Their position logs are created by the same actor, action and comment
    // within one second, so retain the group presentation for those records.
    const legacyGroup = entry.source === 'cfo_position' && entry.log.entity === 'cfo_position'
      ? `legacy:${entry.user?.id || 'unknown'}:${entry.log.action}:${entry.log.comment || ''}:${entry.created_at.slice(0, 19)}`
      : undefined;
    const key = reviewerLineGroup || (eventId ? `event:${eventId}` : legacyGroup || `entry:${entry.id}`);
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) || []), entry]);
  });

  return order.map((id) => {
    const entries = groups.get(id) || [];
    return {
      id,
      entries,
      grouped: entries.length > 1 || entries.some((entry) => (entry.log.item_ids?.length || 0) > 1),
    };
  });
}

export function filterLogsByLine(logs: RequestLog[], lineId?: string, lineName?: string) {
  if (!lineId && !lineName) return logs;
  return logs.filter((entry) => {
    const entityId = entry.log.entity_id || entry.log.req_item_id;
    if (lineId && entityId === lineId) return true;
    if (lineName && entry.subject?.name && entry.subject.name === lineName) return true;
    return false;
  });
}
