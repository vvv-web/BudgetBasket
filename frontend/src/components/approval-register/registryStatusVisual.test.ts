import { describe, expect, it } from 'vitest';
import { groupStatusPresentation, rowStatusPresentation, rowStatusVisual } from './registryStatusVisual';

const baseStatus = {
  tone: 'warning' as const,
  hint: 'Подсказка',
  shortHint: 'Кратко',
};

describe('registry status visuals', () => {
  it('shows the full status text for an actionable row', () => {
    const presentation = rowStatusPresentation({ ...baseStatus, label: 'Ожидает вашего решения' }, {
      is_cfo_review: true,
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
    } as never);
    expect(presentation.primary.text).toBe('Ваше решение');
    expect(presentation.primary.variant).toBe('action');
    expect(presentation.primaryIconOnly).toBe(false);
    expect(presentation.meta).toContain('Ваше действие');
  });

  it('does not add a second status indicator to an editable approved line', () => {
    const presentation = rowStatusPresentation({ ...baseStatus, label: 'Утверждено' }, {
      status: 'approved',
      status_context: {
        editability: {
          can_decide: true,
          can_edit_amount: true,
          can_edit_analytics: true,
          mode: 'editable',
          summary: 'Можно изменить',
          detail: 'Экономист может принять решение',
        },
      },
    } as never);
    expect(presentation.primary.text).toBe('Согласовано');
    expect(presentation.showActionIndicator).toBe(false);
    expect(presentation.footnote).toBe('Требуется ваше решение');
  });

  it('keeps approved row compact and calm', () => {
    const spec = rowStatusVisual({ ...baseStatus, label: 'Утверждено' });
    expect(spec.text).toBe('Согласовано');
    expect(spec.variant).toBe('success');
  });

  it('renders a fixed line as a lock icon', () => {
    const presentation = rowStatusPresentation({ ...baseStatus, label: 'Зафиксировано' });
    expect(presentation.primaryIconOnly).toBe(true);
  });

  it('shows one dominant group status with secondary counts', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100,
      approved_sum: 0,
      rejected_sum: 0,
      pending_sum: 100,
      difference: -100,
      total_rows: 8,
      approved_rows: 0,
      rejected_rows: 2,
      pending_rows: 6,
      requests_count: 2,
      modules_count: 2,
      aggregate_status: 'in_progress',
      collecting_requests: 0,
      cfo_review_requests: 0,
      cfo_review_actionable_requests: 1,
      cfo_review_completable_requests: 0,
      in_approval_positions: 4,
      actionable_positions: 2,
    }, { ...baseStatus, label: 'Ожидает вашего решения' });

    expect(presentation.primary.text).toBe('Ваше решение · 3');
    expect(presentation.primary.variant).toBe('action');
    expect(presentation.meta).toContain('отклонено');
    expect(presentation.meta).toContain('в очереди');
  });

  it('labels a reviewed CFO position as a handoff, not a line decision', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 1, approved_rows: 1, rejected_rows: 0,
      pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'approved', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 1, submission_positions: 1,
    }, { ...baseStatus, label: 'Передайте экономисту' });

    expect(presentation.primary.text).toBe('Передайте экономисту');
  });

  it('labels completed economist line review as a handoff', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 1, approved_rows: 1, rejected_rows: 0,
      pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'approved', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 1, economist_completion_positions: 1,
    }, { ...baseStatus, label: 'Согласуйте и передайте' });

    expect(presentation.primary.text).toBe('Согласуйте и передайте');
  });

  it('labels a fully decided higher-step position as a package handoff', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 2, approved_rows: 2, rejected_rows: 0,
      pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'approved', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 1, workflow_ready_positions: 1,
    }, { ...baseStatus, label: 'Согласуйте и передайте' });

    expect(presentation.primary.text).toBe('Согласуйте и передайте');
    expect(presentation.primary.variant).toBe('action');
    expect(presentation.meta).toContain('пакетной отправке');
  });

  it('shows revision ahead of a stored final line status', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 1, approved_rows: 1, rejected_rows: 0,
      revision_rows: 1, pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'approved', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 0,
    }, { ...baseStatus, label: 'На доработке' });
    expect(presentation.primary.text).toBe('На доработке');
    expect(presentation.primary.variant).toBe('revision');
  });

  it('shows CFO revision status before the repeated decision action', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 1, approved_rows: 1, rejected_rows: 0,
      revision_rows: 1, cfo_revision_rows: 1, pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'approved', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 1, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 1,
    }, { ...baseStatus, label: 'На доработке' });
    expect(presentation.primary.text).toBe('На доработке');
    expect(presentation.primary.variant).toBe('revision');
  });

  it('shows revision ahead of a handoff from another line in the group', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 100, rejected_sum: 0, pending_sum: 0,
      difference: 0, total_rows: 2, approved_rows: 1, rejected_rows: 0,
      revision_rows: 1, pending_rows: 1, requests_count: 1, modules_count: 1,
      aggregate_status: 'in_progress', collecting_requests: 0, cfo_review_requests: 0,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 0,
      in_approval_positions: 1, actionable_positions: 1, submission_positions: 1,
    }, { ...baseStatus, label: 'На доработке' });

    expect(presentation.primary.text).toBe('На доработке');
    expect(presentation.primary.variant).toBe('revision');
  });

  it('keeps the required completion action ahead of stored revision and rejection counts', () => {
    const presentation = groupStatusPresentation({
      requested_sum: 100, approved_sum: 0, rejected_sum: 100, pending_sum: 0,
      difference: -100, total_rows: 1, approved_rows: 0, rejected_rows: 1,
      revision_rows: 1, pending_rows: 0, requests_count: 1, modules_count: 1,
      aggregate_status: 'rejected', collecting_requests: 0, cfo_review_requests: 1,
      cfo_review_actionable_requests: 0, cfo_review_completable_requests: 1,
      in_approval_positions: 0, actionable_positions: 0,
    }, { ...baseStatus, label: 'Завершите проверку' });
    expect(presentation.primary.text).toBe('Завершите проверку');
    expect(presentation.primary.variant).toBe('action');
  });
});
