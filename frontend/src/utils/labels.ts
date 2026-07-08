import type { ItemStatus, RequestStatus, Role } from '../types';

export const roleLabels: Record<Role, string> = {
  admin: 'Администратор',
  economist: 'Экономист',
  employee: 'Сотрудник',
};

export const requestStatusLabels: Record<RequestStatus, string> = {
  draft: 'Черновик',
  submitted: 'Отправлена',
  in_review: 'На проверке',
  fixed: 'Бюджет зафиксирован',
  unfrozen: 'Разморожена',
  cancelled: 'Отменена',
};

export const itemStatusLabels: Record<ItemStatus, string> = {
  in_review: 'На рассмотрении',
  rejected: 'Отказано',
  accepted_adjusted: 'Принято с корректировкой суммы',
  accepted: 'Принято',
};

export function money(value: number | null | undefined): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value || 0);
}
