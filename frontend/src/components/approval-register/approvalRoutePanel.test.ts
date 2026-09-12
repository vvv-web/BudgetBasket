import { describe, expect, it } from 'vitest';
import type { ApprovalStep, User } from '../../types';
import { resolveApprovalRoutePanel } from './approvalRoutePanel';

const cfoResponsible = { id: 'cfo-user', login: 'cfo-user', role: 'employee' } as User;
const economist = { id: 'economist', login: 'economist', role: 'economist' } as User;
const zgd = { id: 'zgd', login: 'zgd', role: 'zgd' } as User;

function step(overrides: Partial<ApprovalStep>): ApprovalStep {
  return {
    id: 'step',
    user_id: null,
    unit_id: null,
    status: 'waiting',
    user: null,
    unit: null,
    cfo: null,
    department: null,
    unit_path: [],
    responsible: null,
    parent_step_ids: [],
    child_step_ids: [],
    ...overrides,
  };
}

describe('compact approval route', () => {
  it('shows module responsibles as the expected lower level for a CFO', () => {
    const cfoStep = step({
      id: 'cfo-step',
      unit_id: 'cfo',
      status: 'on_approval',
      request_status: 'on_approval',
      responsible: cfoResponsible,
      modules: [{
        id: 'module',
        name: 'Module',
        responsible: cfoResponsible,
        request_statuses: [{ status: 'on_review', count: 2 }],
      }],
      parent_step_ids: ['economist-step'],
    });
    const economistStep = step({
      id: 'economist-step',
      user_id: economist.id,
      user: economist,
      parent_step_ids: ['approver-step'],
      child_step_ids: ['cfo-step'],
    });

    const context = resolveApprovalRoutePanel([cfoStep, economistStep], cfoResponsible);

    expect(context.currentStep?.id).toBe('cfo-step');
    expect(context.expectedStepIds).toEqual([]);
    expect(context.expectedModules.map((module) => module.id)).toEqual(['module']);
    expect(context.displaySteps.map((item) => item.id)).toEqual(['cfo-step', 'economist-step']);
  });

  it('keeps graph steps as the expected lower level for other route users', () => {
    const cfoStep = step({ id: 'cfo-step', unit_id: 'cfo', responsible: cfoResponsible });
    const economistStep = step({
      id: 'economist-step',
      user_id: economist.id,
      user: economist,
      parent_step_ids: ['approver-step'],
      child_step_ids: ['cfo-step'],
      modules: cfoStep.modules,
      is_economist_step: true,
    });

    const context = resolveApprovalRoutePanel([cfoStep, economistStep], economist);

    expect(context.expectedStepIds).toEqual(['cfo-step']);
    expect(context.expectedModules).toEqual([]);
  });

  it('keeps only the immediate lower level before the current ZGD step', () => {
    const cfoStep = step({ id: 'cfo-step', unit_id: 'cfo', responsible: cfoResponsible });
    const economistStep = step({
      id: 'economist-step',
      user_id: economist.id,
      user: economist,
      child_step_ids: ['cfo-step'],
    });
    const approverStep = step({
      id: 'approver-step',
      user_id: 'approver',
      child_step_ids: ['economist-step'],
    });
    const zgdStep = step({
      id: 'zgd-step',
      user_id: zgd.id,
      user: zgd,
      status: 'on_approval',
      child_step_ids: ['approver-step'],
    });

    const context = resolveApprovalRoutePanel(
      [cfoStep, economistStep, approverStep, zgdStep],
      zgd,
    );

    expect(context.expectedStepIds).toEqual(['approver-step']);
    expect(context.displaySteps.map((item) => item.id)).toEqual([
      'approver-step', 'zgd-step',
    ]);
  });
});
