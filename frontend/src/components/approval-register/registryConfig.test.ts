import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_DISPLAY_LABELS,
  DEFAULT_COLUMN_VISIBILITY,
  REGISTRY_COLUMNS,
  applyWorkflowColumnVisibility,
  groupReadiness,
  groupReadinessPercent,
  groupHasCfoCompleteActions,
  groupRegistryStatus,
  groupHasCfoDecisionActions,
  groupYourStepSummary,
  groupHasWorkflowActions,
  groupHasWorkflowApprove,
  groupHasWorkflowReturn,
  isGroupActionable,
  isGroupSelectable,
  isRowActionable,
  orderedRegistryColumns,
  parseMoneyInput,
  resolvePointApprovalAmount,
  rowReadiness,
  rowRegistryStatus,
  rowRejectedAmount,
} from './registryConfig';

describe('registry display helpers', () => {
  const sampleAggregates = { requested_sum: 100, approved_sum: 50, rejected_sum: 0, pending_sum: 50, difference: -50, total_rows: 2, approved_rows: 1, rejected_rows: 0, pending_rows: 1, requests_count: 1, modules_count: 1, aggregate_status: 'in_progress' as const, collecting_requests: 0, cfo_review_requests: 0, cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0, in_approval_positions: 0, actionable_positions: 0 };
  const sampleRow = { id: '1', request_id: 'r', request_status: 'on_review' as const, budget_year: 2025, module_id: 'm', module_name: 'Модуль', cfo_id: 'c', cfo_name: 'ЦФО', category_id: 'cat', category_name: 'Категория', article_id: 'a', article_name: 'Статья', kind: 'dds' as const, name: 'Строка', justification: '', comment: '', files_count: 0, requested_sum: 10, approved_sum: 10, status: 'approved' as const, updated_at: '', is_collecting: false, is_cfo_review: false, is_cfo_review_actionable: false, position_id: null, is_in_approval: false, is_approval_actionable: false, approval_stage: null };

  it('shows status-related helpers', () => {
    expect(rowRegistryStatus({ ...sampleRow, is_cfo_revision_pending: true }).label).toBe('Выбрано на доработку');
    expect(groupReadiness(sampleAggregates)).toBe('Проверено: 1 из 2');
    expect(groupReadinessPercent(sampleAggregates)).toBe(50);
    expect(rowReadiness(sampleRow)).toBe('Рассмотрено');
    expect(rowRegistryStatus(sampleRow).label).toBe('Утверждено');
    expect(AGGREGATE_DISPLAY_LABELS.in_progress).toBe('Частично рассмотрено');
    expect(rowRejectedAmount({ ...sampleRow, status: 'rejected', approved_sum: 0 })).toBe(10);
  });

  it('distinguishes sending a reviewed position from a line decision', () => {
    const aggregates = {
      ...sampleAggregates,
      actionable_positions: 1,
      submission_positions: 1,
    };
    expect(groupYourStepSummary(aggregates)).toBe('Передать экономисту: 1');
    expect(groupRegistryStatus(aggregates).label).toBe('Передайте экономисту');
  });

  it('shows revision instead of a handoff when a group contains returned lines', () => {
    expect(groupRegistryStatus({
      ...sampleAggregates,
      actionable_positions: 1,
      submission_positions: 1,
      revision_rows: 1,
    }).label).toBe('На доработке');
  });

  it('keeps an economist-returned CFO group in revision while its decision is available', () => {
    const aggregates = {
      ...sampleAggregates,
      cfo_revision_rows: 1,
      cfo_review_actionable_requests: 1,
    };
    expect(groupRegistryStatus(aggregates).label).toBe('На доработке');
    expect(isGroupActionable({
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates,
    }, 'employee')).toBe(true);
  });

  it('does not expose workflow actions for a group with returned lines', () => {
    const group = {
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates: {
        ...sampleAggregates,
        actionable_positions: 1,
        submission_positions: 1,
        revision_rows: 1,
      },
    };
    expect(groupYourStepSummary(group.aggregates)).toBe('На доработке');
    expect(groupHasWorkflowActions(group)).toBe(false);
    expect(isGroupActionable(group)).toBe(false);
    expect(isGroupSelectable(group)).toBe(false);
  });

  it('lets economist, approver and ZGD act on a group returned to their step', () => {
    const group = {
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates: {
        ...sampleAggregates,
        actionable_positions: 1,
        revision_rows: 1,
        workflow_ready_positions: 1,
      },
    };
    expect(groupHasWorkflowActions(group, 'economist')).toBe(true);
    expect(groupHasWorkflowApprove(group, 'economist')).toBe(true);
    expect(isGroupActionable(group, 'economist')).toBe(true);
    expect(isGroupSelectable(group, 'economist')).toBe(true);

    expect(groupHasWorkflowActions(group, 'approver')).toBe(true);
    expect(groupHasWorkflowApprove(group, 'approver')).toBe(true);
    expect(isGroupActionable(group, 'approver')).toBe(true);
    expect(isGroupSelectable(group, 'approver')).toBe(true);
    expect(groupHasWorkflowApprove(group, 'approver')).toBe(true);

    expect(groupHasWorkflowActions(group, 'zgd')).toBe(true);
    expect(groupHasWorkflowApprove(group, 'zgd')).toBe(false);
  });

  it('keeps package actions hidden until the current reviewer decides every line', () => {
    const group = {
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates: { ...sampleAggregates, actionable_positions: 1, workflow_ready_positions: 0 },
    };
    expect(groupHasWorkflowActions(group, 'approver')).toBe(true);
    expect(groupHasWorkflowApprove(group, 'approver')).toBe(false);
    expect(isGroupActionable(group, 'approver')).toBe(true);
  });

  it('does not expose CFO handoff while another request is still pending', () => {
    const group = {
      id: 'group', type: 'cfo' as const, name: 'CFO', label: 'CFO', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request-a', 'request-b'], can_load_rows: false,
      aggregates: {
        ...sampleAggregates,
        cfo_review_completable_requests: 1,
        cfo_review_actionable_requests: 1,
        submission_positions: 1,
      },
    };
    expect(groupHasCfoCompleteActions(group)).toBe(false);
    expect(groupHasWorkflowApprove(group, 'employee')).toBe(false);
  });

  it('does not expose CFO handoff while a module request is still a draft', () => {
    const group = {
      id: 'group', type: 'cfo' as const, name: 'CFO', label: 'CFO', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request-a', 'request-b'], can_load_rows: false,
      aggregates: {
        ...sampleAggregates,
        requests_count: 2,
        cfo_unsubmitted_requests: 1,
        cfo_review_completable_requests: 1,
        submission_positions: 1,
      },
    };
    expect(groupHasCfoCompleteActions(group)).toBe(false);
    expect(groupHasWorkflowApprove(group, 'employee')).toBe(false);
  });

  it('limits group selection to actions available to the current role', () => {
    const workflowOnlyGroup = {
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates: { ...sampleAggregates, actionable_positions: 1 },
    };
    const cfoCompletionGroup = {
      ...workflowOnlyGroup,
      aggregates: { ...sampleAggregates, cfo_review_completable_requests: 1 },
    };

    expect(isGroupSelectable(workflowOnlyGroup, 'employee')).toBe(true);
    expect(isGroupSelectable(workflowOnlyGroup, 'economist')).toBe(true);
    expect(isGroupSelectable(cfoCompletionGroup, 'employee')).toBe(true);
    expect(isGroupSelectable(cfoCompletionGroup, 'economist')).toBe(false);
  });

  it('distinguishes economist completion from a line decision', () => {
    const aggregates = {
      ...sampleAggregates,
      actionable_positions: 1,
      economist_completion_positions: 1,
    };
    expect(groupYourStepSummary(aggregates)).toBe('Согласовать и передать: 1');
    expect(groupRegistryStatus(aggregates).label).toBe('Согласуйте и передайте');
  });

  it('allows a responsible CFO to reject a group before handoff', () => {
    const group = {
      id: 'group', type: 'article' as const, name: 'Article', label: 'Article', children: [],
      module_id: 'module', article_id: 'article', category_id: 'category', request_ids: ['request'], can_load_rows: false,
      aggregates: { ...sampleAggregates, cfo_review_completable_requests: 1 },
    };
    expect(groupHasCfoDecisionActions(group, 'employee')).toBe(true);
    expect(groupHasCfoDecisionActions(group, 'economist')).toBe(false);
  });

  it('explains draft and waiting states clearly', () => {
    expect(rowRegistryStatus({ ...sampleRow, status: 'on_review', is_collecting: true, request_status: 'draft' }).label).toBe('Черновик');
    expect(rowRegistryStatus({
      ...sampleRow,
      status: 'on_review',
      is_in_approval: true,
      is_approval_actionable: false,
      approval_stage: 'Проверка экономистом ЦФО',
    }).label).toBe('Ожидает предыдущих этапов');
    expect(rowRegistryStatus({
      ...sampleRow,
      status: 'approved',
      is_in_approval: true,
      is_approval_actionable: false,
      is_decision_editable: false,
      is_position_submission_actionable: false,
      is_workflow_submission_actionable: false,
      is_workflow_revision_actionable: false,
      approval_stage: 'Согласование проверяющим',
    }).label).toBe('На согласовании');
    expect(groupRegistryStatus({ ...sampleAggregates, collecting_requests: 1, requests_count: 1 }).label).toBe('Черновик');
    expect(groupRegistryStatus({ ...sampleAggregates, cfo_review_actionable_requests: 1 }).label).toBe('Ожидает вашего решения');
    expect(groupRegistryStatus({ ...sampleAggregates, cfo_review_completable_requests: 1 }).label).toBe('Завершите проверку');
    expect(groupRegistryStatus({ ...sampleAggregates, aggregate_status: 'rejected', rejected_rows: 2, pending_rows: 0, cfo_review_completable_requests: 1, revision_rows: 1 }).label).toBe('Завершите проверку');
    expect(groupRegistryStatus({ ...sampleAggregates, aggregate_status: 'approved', revision_rows: 1 }).label).toBe('На доработке');
  });

  it('keeps rejection distinct from revision', () => {
    expect(rowRegistryStatus({ ...sampleRow, status: 'rejected' }).label).toBe('Отклонено');
    expect(rowRegistryStatus({ ...sampleRow, status: 'deleted', is_collecting: true, request_status: 'draft' }).label).toBe('Удалена');
    expect(rowRegistryStatus({ ...sampleRow, is_revision: true, is_revision_actionable: false }).label).toBe('На доработке');
    expect(rowRegistryStatus({
      ...sampleRow,
      is_revision: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: false,
          mode: 'readonly',
          summary: 'Решение принято',
          detail: 'Повторное решение сохранено',
        },
      },
    }).label).toBe('На доработке');
    expect(rowRegistryStatus({
      ...sampleRow,
      is_revision: true,
      is_current_step_owner: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: false,
          mode: 'readonly',
          summary: 'Решение принято',
          detail: 'Повторное решение сохранено',
        },
      },
    }).label).toBe('Согласовано после доработки');
    expect(rowRegistryStatus({
      ...sampleRow,
      is_revision: true,
      is_position_submission_actionable: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: false,
          mode: 'readonly',
          summary: 'На доработке',
          detail: 'Позиция ждёт повторной проверки ЦФО',
        },
      },
    }).label).toBe('Утверждено');
    expect(rowRegistryStatus({
      ...sampleRow,
      status: 'rejected',
      is_position_submission_actionable: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: false,
          mode: 'readonly',
          summary: 'Решение сохранено',
          detail: 'Позиция готова к передаче экономисту',
        },
      },
    }).label).toBe('Отклонено');
    expect(rowRegistryStatus({
      ...sampleRow,
      status: 'on_review',
      is_position_submission_actionable: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: false,
          mode: 'readonly',
          summary: 'Решение сохранено',
          detail: 'Позиция готова к передаче экономисту',
        },
        last_decision: {
          at: '',
          action: 'cfo_item_decided',
          action_label: 'Решение ответственного ЦФО',
          item_status: 'approved_with_changes',
        },
      },
    }).label).toBe('Утверждено с изменениями');
    expect(rowRegistryStatus({
      ...sampleRow,
      is_revision: true,
      is_module_revision: true,
      is_revision_actionable: false,
      is_position_submission_actionable: true,
    }).label).toBe('На доработке');
    expect(rowRegistryStatus({
      ...sampleRow,
      is_revision: true,
      is_revision_actionable: true,
      is_position_submission_actionable: true,
    }).label).toBe('На доработке');
  });

  it('shows the saved decision while allowing it to be changed', () => {
    const editableContext = {
      editability: {
        can_decide: true,
        can_edit_amount: true,
        can_edit_analytics: true,
        mode: 'editable' as const,
        summary: 'Решение можно изменить',
        detail: 'Измените решение до передачи строки на следующий этап',
      },
      last_decision: {
        at: '',
        action: 'cfo_item_decided',
        action_label: 'Решение ответственного ЦФО',
        item_status: 'approved' as const,
      },
    };
    expect(rowRegistryStatus({ ...sampleRow, status: 'on_review', is_decision_editable: true, status_context: editableContext }).label).toBe('Утверждено');
    expect(rowRegistryStatus({ ...sampleRow, status: 'on_review', is_decision_editable: true, status_context: { ...editableContext, last_decision: { ...editableContext.last_decision, item_status: 'approved_with_changes' as const } } }).label).toBe('Утверждено с изменениями');
    expect(rowRegistryStatus({ ...sampleRow, status: 'on_review', is_decision_editable: true, status_context: { ...editableContext, last_decision: { ...editableContext.last_decision, item_status: 'rejected' as const } } }).label).toBe('Отклонено');
  });

  it('keeps a pending editable line as awaiting a decision', () => {
    expect(rowRegistryStatus({
      ...sampleRow,
      status: 'on_review',
      is_decision_editable: false,
      status_context: {
        editability: {
          can_decide: true,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable' as const,
          summary: 'Можно принять решение',
          detail: 'Вы можете согласовать строку',
        },
      },
    }).label).toBe('Ожидает вашего решения');
  });

  it('does not treat already decided lines as actionable', () => {
    const decidedButCfoReview = {
      ...sampleRow,
      status: 'on_review' as const,
      is_cfo_review: true,
      is_cfo_review_actionable: true,
      status_context: {
        editability: {
          can_decide: false,
          can_edit_amount: false,
          can_edit_analytics: true,
          mode: 'readonly' as const,
          summary: 'Решение принято',
          detail: 'Решение уже принято',
        },
      },
    };
    expect(isRowActionable(decidedButCfoReview)).toBe(false);

    const pending = {
      ...sampleRow,
      status: 'on_review' as const,
      is_cfo_review: true,
      is_cfo_review_actionable: true,
      status_context: {
        editability: {
          can_decide: true,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable' as const,
          summary: 'Можно изменить',
          detail: 'Вы можете согласовать строку',
        },
      },
    };
    expect(isRowActionable(pending)).toBe(true);

    const economistLine = {
      ...sampleRow,
      status: 'approved' as const,
      position_id: 'pos-1',
      is_in_approval: true,
      is_approval_actionable: true,
      approval_stage: 'Проверка экономистом ЦФО',
      status_context: {
        editability: {
          can_decide: true,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable' as const,
          summary: 'Можно изменить',
          detail: 'Экономист может принять решение',
        },
      },
    };
    expect(isRowActionable(economistLine)).toBe(true);

    expect(isRowActionable({ ...economistLine, is_cfo_review_actionable: false }, 'approver')).toBe(true);
    expect(isRowActionable({ ...economistLine, is_cfo_review_actionable: false }, 'zgd')).toBe(true);
  });

  it('parses amounts with spaces and rejects non-numeric input', () => {
    expect(parseMoneyInput('1 250,50')).toBe(1250.5);
    expect(parseMoneyInput('12x')).toBeNull();
  });

  it('offers an approver a group return independently of package approval', () => {
    const group = {
      aggregates: {
        workflow_ready_positions: 0,
        workflow_return_positions: 1,
      },
    } as never;

    expect(groupHasWorkflowReturn(group, 'approver')).toBe(true);
    expect(groupHasWorkflowReturn(group, 'economist')).toBe(false);
    expect(groupHasWorkflowReturn(group, 'zgd')).toBe(true);
  });

  it('uses the full plan for a point approval until a fact is entered', () => {
    expect(resolvePointApprovalAmount(100, 0, false)).toBe(100);
    expect(resolvePointApprovalAmount(100, 150, true)).toBe(150);
    expect(resolvePointApprovalAmount(100, 0, true)).toBe(0);
  });

  it('uses saved column order and hidden columns', () => {
    const visibility = { ...DEFAULT_COLUMN_VISIBILITY, comment: false };
    const ids = orderedRegistryColumns(['select', 'structure', 'status', 'requested'], visibility).map((column) => column.id);
    expect(ids.slice(0, 4)).toEqual(['select', 'structure', 'status', 'requested']);
    expect(ids).not.toContain('comment');
    expect(ids).not.toContain('readiness');
  });

  it('preserves selections for data columns while keeping structural columns visible', () => {
    expect(REGISTRY_COLUMNS.filter((column) => ['structure', 'requested', 'approved', 'rejected', 'status'].includes(column.id)).map((column) => column.label))
      .toEqual(['Структура', 'План, ₽', 'Факт, ₽', 'Корректировка, ₽', 'Статус']);

    const visibility = applyWorkflowColumnVisibility({ ...DEFAULT_COLUMN_VISIBILITY, status: false, your_step: true, actions: true }, 'economist');
    expect(visibility.status).toBe(false);
    expect(visibility.your_step).toBe(true);
    expect(visibility.actions).toBe(true);
    expect(visibility.select).toBe(true);
    expect(visibility.structure).toBe(true);
  });

  it('does not include secondary workflow columns in the register table', () => {
    const ids = REGISTRY_COLUMNS.map((column) => column.id);
    expect(ids).not.toContain('your_step');
    expect(ids).not.toContain('previous_step');
    expect(ids).not.toContain('actions');
  });
});
