import { describe, expect, it } from 'vitest';
import type { ApprovalRegisterRow } from '../../types';
import { lineStatusFootnote, lineStatusTooltipLines } from './registryLineContext';

const baseRow: ApprovalRegisterRow = {
  id: 'item-1',
  request_id: 'req-1',
  request_status: 'on_review',
  budget_year: 2026,
  module_id: 'mod-1',
  module_name: 'Модуль',
  cfo_id: 'cfo-1',
  cfo_name: 'ЦФО',
  category_id: 'cat-1',
  category_name: 'Категория',
  article_id: 'art-1',
  article_name: 'Статья',
  kind: 'dds',
  name: 'Строка',
  justification: '',
  comment: '',
  files_count: 0,
  requested_sum: 100,
  approved_sum: 100,
  status: 'approved',
  updated_at: '2026-08-07T10:00:00Z',
  is_collecting: false,
  is_cfo_review: false,
  is_cfo_review_actionable: false,
  position_id: 'pos-1',
  is_in_approval: false,
  is_approval_actionable: false,
  approval_stage: null,
};

describe('registryLineContext', () => {
  it('shows who decided for approved lines', () => {
    const row: ApprovalRegisterRow = {
      ...baseRow,
      status_context: {
        last_decision: {
          at: '2026-08-07T10:00:00Z',
          by_name: 'Иванов Иван',
          action: 'cfo_item_decided',
          action_label: 'Решение ответственного ЦФО',
          stage: 'Проверка ЦФО',
        },
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: true,
          mode: 'readonly',
          summary: 'Решение принято',
          detail: 'Решение уже принято',
        },
      },
    };
    expect(lineStatusFootnote(row)).toBe('Иванов Иван · Проверка ЦФО');
    expect(lineStatusTooltipLines(row).some((line) => line.includes('Иванов Иван'))).toBe(true);
  });

  it('shows the concrete action when user can decide', () => {
    const row: ApprovalRegisterRow = {
      ...baseRow,
      status: 'on_review',
      status_context: {
        editability: {
          can_decide: true,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable',
          summary: 'Можно изменить',
          detail: 'Вы можете согласовать строку',
        },
      },
    };
    expect(lineStatusFootnote(row)).toBe('Требуется ваше решение');
    expect(lineStatusTooltipLines(row)).toContain('Доступно: согласовать, согласовать с корректировкой или отклонить строку');
  });

  it('distinguishes correction from a final decision', () => {
    const row: ApprovalRegisterRow = {
      ...baseRow,
      is_revision_actionable: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable',
          summary: 'На доработке',
          detail: 'Исправьте возвращённую строку',
        },
      },
    };
    expect(lineStatusFootnote(row)).toBe('Ваше действие: исправить и повторно отправить');
    expect(lineStatusTooltipLines(row)).toContain('Доступно: исправить строку и повторно отправить её на проверку');
  });
});
