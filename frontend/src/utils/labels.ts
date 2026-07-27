import type { ItemStatus, RequestStatus, Role } from '../types';

export const roleLabels: Record<Role, string> = {
  admin: 'Администратор',
  economist: 'Экономист',
  employee: 'Сотрудник',
  approver: 'Согласующий',
  zgd: 'ЗГД',
};

export const stepStatusLabels = {
  waiting: 'Ожидает согласования предыдущих этапов',
  on_approval: 'На согласовании',
  on_revision: 'На доработке',
  approved: 'Согласован',
  closed: 'Закрыт',
} as const;

export const requestStatusLabels: Record<RequestStatus, string> = {
  draft: 'Черновик',
  on_review: 'На проверке',
  approved: 'Утверждена',
  approved_with_changes: 'Утверждена с изменениями',
  partially_approved: 'Частично утверждена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

export const itemStatusLabels: Record<ItemStatus, string> = {
  on_review: 'На рассмотрении',
  rejected: 'Отказано',
  approved_with_changes: 'Утверждено с изменениями',
  approved: 'Утверждено',
  deleted: 'Удалено',
};

export function money(value: number | null | undefined): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value || 0);
}
