import type { ApprovalStep, BudgetRequest, CfoPosition, User } from '../types';
import { roleLabels, stepStatusLabels } from './labels';

export type PositionWorkflowAction =
  | 'submit'
  | 'decide_items'
  | 'complete_review'
  | 'freeze'
  | 'unfreeze'
  | 'approve'
  | 'fix'
  | null;

export type WorkflowPresentation = {
  stateLabel: string;
  stageLabel: string;
  ownerLabel: string | null;
  requirement: string;
  action: PositionWorkflowAction;
  actionLabel: string | null;
  isCurrentUserAction: boolean;
  severity: 'success' | 'info' | 'warning';
};

export function workflowPersonName(user?: User | null) {
  if (!user) return 'исполнитель не назначен';
  const profile = user.profile;
  return [profile?.last_name, profile?.name, profile?.second_name].filter(Boolean).join(' ') || user.login;
}

export function stepAssignee(step?: ApprovalStep | null) {
  if (!step) return null;
  return step.unit_id ? step.responsible : step.user;
}

export function workflowStageLabel(step?: ApprovalStep | null) {
  if (!step) return 'Маршрут завершён';
  if (step.unit_id) return `Проверка ответственным ЦФО · ${step.unit?.name || step.cfo?.name || 'ЦФО'}`;
  if (step.is_economist_step) return `Проверка экономистом ЦФО · ${step.cfo_names?.join(', ') || step.cfo?.name || 'ЦФО'}`;
  if (step.user?.role === 'zgd') return 'Финальное согласование ЗГД';
  return `Согласование · ${workflowPersonName(step.user)}`;
}

function ownerLabel(step?: ApprovalStep | null) {
  const assignee = stepAssignee(step);
  if (!step) return null;
  const role = step.unit_id ? 'Ответственный ЦФО' : step.is_economist_step ? 'Экономист' : step.user?.role ? roleLabels[step.user.role] : 'Исполнитель';
  return `${role}: ${workflowPersonName(assignee)}`;
}

export function positionWorkflowPresentation(position: CfoPosition, user: User): WorkflowPresentation {
  const step = position.current_step;
  const assignee = stepAssignee(step);
  const isMine = Boolean(assignee?.id && assignee.id === user.id);
  const stageLabel = workflowStageLabel(step);
  const currentOwner = ownerLabel(step);

  if (position.all_items_fixed) {
    return {
      stateLabel: 'Зафиксировано ЗГД',
      stageLabel: 'Маршрут завершён',
      ownerLabel: null,
      requirement: 'Бюджет окончательно утверждён. Действия и изменения недоступны.',
      action: null,
      actionLabel: null,
      isCurrentUserAction: false,
      severity: 'success',
    };
  }

  if (!step) {
    return {
      stateLabel: 'Ожидает следующего этапа',
      stageLabel,
      ownerLabel: null,
      requirement: 'Активный шаг маршрута пока не определён. Обновите страницу или обратитесь к администратору маршрута.',
      action: null,
      actionLabel: null,
      isCurrentUserAction: false,
      severity: 'info',
    };
  }

  if (!isMine) {
    return {
      stateLabel: position.status === 'on_revision' ? 'На доработке' : stepStatusLabels[step.request_status || step.status],
      stageLabel,
      ownerLabel: currentOwner,
      requirement: `От вас сейчас действий не требуется. ${currentOwner ? `Ожидается действие: ${currentOwner}.` : 'Ожидается назначенный участник.'}`,
      action: null,
      actionLabel: null,
      isCurrentUserAction: false,
      severity: position.status === 'on_revision' ? 'warning' : 'info',
    };
  }

  if (step.unit_id) {
    const repeated = position.status === 'on_revision';
    return {
      stateLabel: repeated ? 'Возвращено ответственному ЦФО' : 'Проверка ЦФО',
      stageLabel,
      ownerLabel: currentOwner,
      requirement: repeated
        ? 'Проверьте исправления и повторно передайте позицию экономисту.'
        : 'Завершите проверку всех заявок ЦФО и передайте готовый пакет экономисту.',
      action: 'submit',
      actionLabel: repeated ? 'Повторно передать экономисту' : 'Передать экономисту',
      isCurrentUserAction: true,
      severity: 'warning',
    };
  }

  if (step.is_economist_step) {
    if (position.status === 'on_revision' && position.frozen_items_count > 0) {
      return {
        stateLabel: 'Возвращено экономисту', stageLabel, ownerLabel: currentOwner,
        requirement: 'Разморозьте возвращённые строки, внесите правки и примите решения повторно.',
        action: 'unfreeze', actionLabel: 'Разморозить для доработки', isCurrentUserAction: true, severity: 'warning',
      };
    }
    if (position.status === 'approved') {
      return {
        stateLabel: 'Проверка строк завершена', stageLabel, ownerLabel: currentOwner,
        requirement: 'Заморозьте согласованные значения и передайте позицию следующему согласующему.',
        action: 'freeze', actionLabel: 'Заморозить и передать', isCurrentUserAction: true, severity: 'warning',
      };
    }
    const undecided = position.contributions.filter((item) => item.status === 'on_review' && !item.fixed && !item.frozen).length;
    if (undecided > 0) {
      return {
        stateLabel: 'Проверка экономистом', stageLabel, ownerLabel: currentOwner,
        requirement: `Примите решение по ${undecided} ${undecided === 1 ? 'строке' : 'строкам'}, затем завершите проверку.`,
        action: 'decide_items', actionLabel: 'Принять решения по строкам', isCurrentUserAction: true, severity: 'warning',
      };
    }
    return {
      stateLabel: 'Все строки рассмотрены', stageLabel, ownerLabel: currentOwner,
      requirement: 'Завершите проверку строк, чтобы перейти к заморозке бюджета.',
      action: 'complete_review', actionLabel: 'Завершить проверку строк', isCurrentUserAction: true, severity: 'warning',
    };
  }

  if (step.user?.role === 'zgd') {
    return {
      stateLabel: position.status === 'on_revision' ? 'Повторное согласование ЗГД' : 'Финальное согласование',
      stageLabel, ownerLabel: currentOwner,
      requirement: 'Проверьте позицию: зафиксируйте бюджет окончательно или верните непосредственному нижнему шагу.',
      action: 'fix', actionLabel: 'Зафиксировать бюджет', isCurrentUserAction: true, severity: 'warning',
    };
  }

  return {
    stateLabel: position.status === 'on_revision' ? 'Повторное согласование' : 'На согласовании',
    stageLabel, ownerLabel: currentOwner,
    requirement: 'Проверьте позицию: согласуйте и передайте дальше либо верните на непосредственный нижний шаг.',
    action: 'approve', actionLabel: 'Согласовать и передать', isCurrentUserAction: true, severity: 'warning',
  };
}

export function stepViewerRequirement(step: ApprovalStep, viewerUserId: string) {
  const mine = stepAssignee(step)?.id === viewerUserId;
  const status = step.request_status || step.status;
  if (!mine) return null;
  const readiness = stepReadinessLabels(step);
  if (readiness.length) return readiness[0];
  if (status === 'on_approval') return 'Требуется ваше решение сейчас';
  if (status === 'on_revision') return 'Требуется повторная проверка';
  if (status === 'approved') return 'Ваш этап завершён';
  if (status === 'closed') return 'Маршрут закрыт';
  return 'Ваших действий пока нет';
}

export function stepReadinessLabels(step: ApprovalStep): string[] {
  const readiness = step.readiness;
  if (!readiness) return [];
  const labels: string[] = [];
  if (readiness.needs_line_decisions) {
    labels.push(`Нужны решения по строкам: ${readiness.needs_line_decisions}`);
  }
  if (readiness.awaiting_return_confirmation) {
    labels.push(`Ожидают подтверждения возврата: ${readiness.awaiting_return_confirmation}`);
  }
  if (readiness.needs_revision && (step.request_status || step.status) !== 'on_revision') {
    labels.push(`Нужна доработка: ${readiness.needs_revision}`);
  }
  if (readiness.ready_for_next_action) {
    labels.push(`Готовы к следующему действию: ${readiness.ready_for_next_action}`);
  }
  return labels;
}

export function requestWorkflowRequirement(request: BudgetRequest, activeStep?: ApprovalStep | null) {
  if (request.status === 'draft') return 'Заполните строки заявки и отправьте её ответственному ЦФО.';
  if (request.status === 'cancelled') return 'Заявка отменена. Для продолжения восстановите её в черновик.';
  if (request.status === 'rejected') return 'Заявка отклонена. Бюджет по её строкам не выделен.';
  if (request.status === 'approved') return 'Заявка окончательно утверждена после фиксации ЗГД.';
  if (request.available_actions?.includes('edit_revision')) return 'Исправьте возвращённые строки и повторно отправьте заявку ответственному ЦФО.';
  return activeStep
    ? `Сейчас заявка находится на этапе «${workflowStageLabel(activeStep)}». Действия выполняет назначенный участник этого этапа.`
    : 'Заявка участвует в согласовании. Ожидается формирование или назначение текущего шага.';
}
