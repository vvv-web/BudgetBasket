import type { ApprovalRegisterRow } from '../../types';

function formatDecisionDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function lineStatusFootnote(item?: ApprovalRegisterRow) {
  const context = item?.status_context;
  if (!context) return undefined;

  const { editability, last_decision: lastDecision, current_owner: currentOwner } = context;
  if (item?.is_revision_actionable) return 'Ваше действие: исправить и повторно отправить';
  if (item?.is_module_revision) return 'Строка возвращена модулю на доработку';
  if (item?.is_position_submission_actionable) return 'Ваше действие: передать экономисту';
  if (item?.is_decision_editable) return 'Ваше действие: изменить решение до передачи строки на следующий этап';
  if (editability.mode === 'editable' && editability.can_decide) {
    if (item?.is_cfo_review_actionable || item?.is_cfo_review) return 'Ваше действие: проверить строку';
    if (item?.is_approval_actionable) return 'Ваше действие: согласовать или отклонить';
    return 'Требуется ваше решение';
  }

  if (lastDecision?.by_name && (item?.status === 'approved' || item?.status === 'approved_with_changes' || item?.status === 'rejected')) {
    const stage = lastDecision.stage ? ` · ${lastDecision.stage}` : '';
    return `${lastDecision.by_name}${stage}`;
  }

  if (currentOwner?.by_name && editability.mode === 'readonly' && !editability.can_decide) {
    return `Ждёт: ${currentOwner.by_name}`;
  }

  return editability.summary || undefined;
}

export function lineStatusTooltipLines(item?: ApprovalRegisterRow) {
  const context = item?.status_context;
  if (!context) return [];

  const lines: string[] = [];
  const { editability, last_decision: lastDecision, current_owner: currentOwner } = context;

  if (editability.detail) lines.push(editability.detail);

  if (lastDecision?.by_name) {
    const when = formatDecisionDate(lastDecision.at);
    const parts = [`Последнее решение: ${lastDecision.action_label}`, `Кто: ${lastDecision.by_name}`];
    if (when) parts.push(`Когда: ${when}`);
    if (lastDecision.stage) parts.push(`Этап: ${lastDecision.stage}`);
    lines.push(parts.join(' · '));
  }

  if (currentOwner?.by_name && editability.mode !== 'editable') {
    lines.push(`Сейчас ждёт ${currentOwner.role_label}: ${currentOwner.by_name}`);
  }

  if (item?.is_revision_actionable) {
    lines.push('Доступно: исправить строку и повторно отправить её на проверку');
  } else if (item?.is_module_revision) {
    lines.push('Строка возвращена модулю на доработку');
  } else if (item?.is_position_submission_actionable) {
    lines.push('Доступно: передать проверенную позицию экономисту');
  } else if (item?.is_decision_editable) {
    lines.push('Доступно: изменить своё решение до передачи строки на следующий этап');
  } else if (editability.mode === 'editable' && editability.can_decide) {
    lines.push('Доступно: согласовать, согласовать с корректировкой или отклонить строку');
  } else if (editability.mode === 'editable') {
    lines.push('Доступно: изменить данные строки');
  } else if (editability.mode === 'locked') {
    lines.push('Изменения заблокированы');
  } else {
    lines.push('Изменения недоступны на текущем этапе');
  }

  return [...new Set(lines.filter(Boolean))];
}
