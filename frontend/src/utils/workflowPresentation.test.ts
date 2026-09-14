import { describe, expect, it } from 'vitest';
import type { ApprovalStep, CfoPosition, User } from '../types';
import { positionWorkflowPresentation, stepReadinessLabels, stepViewerRequirement } from './workflowPresentation';

const user = { id: 'u1', login: 'user', role: 'economist' } as User;
const economistStep = {
  id: 's1', user_id: 'u1', unit_id: null, status: 'on_approval', request_status: 'on_approval',
  user, responsible: null, unit: null, cfo: null, department: null, unit_path: [],
  parent_step_ids: [], child_step_ids: [], is_economist_step: true, cfo_names: ['ЦФО 1'],
} as ApprovalStep;
const position = {
  id: 'p1', budget_year: 2026, cfo_unit_id: 'c1', status: 'on_approval', current_step_id: 's1',
  frozen_items_count: 0, fixed_items_count: 0, open_items_count: 1, all_items_frozen: false,
  all_items_fixed: false, can_forward: false, sum_plan: 100, sum_fact: 0, items_count: 1,
  current_step: economistStep,
  contributions: [{ id: 'i1', status: 'on_review', frozen: false, fixed: false }],
} as CfoPosition;

describe('workflow presentation', () => {
  it('shows a concrete action only to the assigned current user', () => {
    const mine = positionWorkflowPresentation(position, user);
    expect(mine.isCurrentUserAction).toBe(true);
    expect(mine.action).toBe('decide_items');
    expect(mine.requirement).toContain('1 строке');

    const other = positionWorkflowPresentation(position, { ...user, id: 'other' });
    expect(other.isCurrentUserAction).toBe(false);
    expect(other.action).toBeNull();
    expect(other.requirement).toContain('От вас сейчас действий не требуется');
  });

  it('distinguishes completion, freeze and final fixation', () => {
    expect(positionWorkflowPresentation({ ...position, contributions: [{ ...position.contributions[0], status: 'approved' }] }, user).action).toBe('complete_review');
    expect(positionWorkflowPresentation({ ...position, status: 'approved', contributions: [{ ...position.contributions[0], status: 'approved' }] }, user).action).toBe('freeze');
    expect(positionWorkflowPresentation({ ...position, all_items_fixed: true, current_step: null }, user).stateLabel).toBe('Зафиксировано ЗГД');
  });

  it('explains the viewer step state', () => {
    expect(stepViewerRequirement(economistStep, 'u1')).toBe('Требуется ваше решение сейчас');
    expect(stepViewerRequirement(economistStep, 'other')).toBeNull();
  });

  it('keeps route state separate from position readiness', () => {
    expect(stepReadinessLabels({
      ...economistStep,
      readiness: {
        needs_line_decisions: 0,
        awaiting_return_confirmation: 0,
        needs_revision: 0,
        ready_for_next_action: 6,
      },
    })).toEqual(['Готовы к следующему действию: 6']);
    expect(stepReadinessLabels({
      ...economistStep,
      status: 'on_revision',
      request_status: 'on_revision',
      readiness: {
        needs_line_decisions: 0,
        awaiting_return_confirmation: 0,
        needs_revision: 1,
        ready_for_next_action: 0,
      },
    })).toEqual([]);
  });
});
