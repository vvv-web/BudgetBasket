import type { ApprovalStep, User } from '../../types';

export type ApprovalRouteModule = NonNullable<ApprovalStep['modules']>[number];

export type ApprovalRoutePanelContext = {
  currentStep: ApprovalStep | undefined;
  expectedStepIds: string[];
  nextStepIds: string[];
  displaySteps: ApprovalStep[];
  expectedModules: ApprovalRouteModule[];
};

function stepStatus(step: ApprovalStep) {
  return step.request_status || step.status;
}

/**
 * Resolve the compact route around the viewer's step.
 *
 * A CFO step is a workflow leaf, while the module responsibles are stored in
 * the step's module context rather than as graph steps. Treat that context as
 * the expected lower level only for a CFO viewer. For every viewer, keep only
 * the immediate lower and upper route levels around the current step.
 */
export function resolveApprovalRoutePanel(
  steps: ApprovalStep[],
  user: User,
): ApprovalRoutePanelContext {
  const viewerSteps = steps.filter((step) => (
    step.unit_id ? step.responsible?.id === user.id : step.user_id === user.id
  ));
  const currentStep = viewerSteps.find((step) => (
    stepStatus(step) === 'on_approval' || stepStatus(step) === 'on_revision'
  )) || viewerSteps[0];
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const expectedStepIds = currentStep
    ? [...new Set(currentStep.child_step_ids || [])].filter((stepId) => stepsById.has(stepId))
    : [];
  const nextStepIds = currentStep
    ? [...new Set(currentStep.parent_step_ids || [])].filter((stepId) => stepsById.has(stepId))
    : [];
  const visibleRouteIds = currentStep
    ? new Set([...expectedStepIds, currentStep.id, ...nextStepIds])
    : new Set(steps.map((step) => step.id));
  const routeStateRank = (step: ApprovalStep) => {
    const expectedIndex = expectedStepIds.indexOf(step.id);
    if (expectedIndex !== -1) return expectedIndex;
    if (step.id === currentStep?.id) return expectedStepIds.length;
    const nextIndex = nextStepIds.indexOf(step.id);
    if (nextIndex !== -1) return expectedStepIds.length + 1 + nextIndex;
    return Number.MAX_SAFE_INTEGER;
  };
  const displaySteps = steps
    .filter((step) => visibleRouteIds.has(step.id))
    .sort((left, right) => (
      routeStateRank(left) - routeStateRank(right)
      || left.id.localeCompare(right.id)
    ));

  return {
    currentStep,
    expectedStepIds,
    nextStepIds,
    displaySteps,
    expectedModules: currentStep?.unit_id && expectedStepIds.length === 0
      ? currentStep.modules || []
      : [],
  };
}
