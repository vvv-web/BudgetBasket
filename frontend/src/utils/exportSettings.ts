import type { BudgetRequest, RequestStatus, Unit, User } from '../types';
import { EXPORTABLE_REQUEST_STATUSES } from '../types';

export type ExportKind = 'all' | 'expense' | 'income';

export type ExportSettingsState = {
  statuses: RequestStatus[];
  fixed_only: boolean;
  export_kind: ExportKind;
  department_ids: string[];
  module_ids: string[];
  include_files: boolean;
};

export const CLOSED_EXPORT_STATUSES: RequestStatus[] = [...EXPORTABLE_REQUEST_STATUSES, 'rejected'];
export const REGISTER_EXPORT_STATUSES: RequestStatus[] = ['draft', 'on_review', 'approved', 'rejected', 'cancelled'];

export function defaultExportSettings(user: User, includeFiles = user.role === 'zgd'): ExportSettingsState {
  return {
    statuses: [...EXPORTABLE_REQUEST_STATUSES],
    fixed_only: false,
    export_kind: 'all',
    department_ids: [],
    module_ids: [],
    include_files: includeFiles,
  };
}

export function unitSelectionFromId(unitId: string, units: Unit[]): Pick<ExportSettingsState, 'department_ids' | 'module_ids'> {
  const unit = units.find((item) => item.id === unitId);
  if (!unit) return { department_ids: [], module_ids: [] };
  if (!unit.parent_id) return { department_ids: [unit.id], module_ids: [] };
  return { department_ids: [], module_ids: [unit.id] };
}

function unitCoversVisible(unitId: string, visibleIds: Set<string>, units: Unit[]): boolean {
  if (visibleIds.has(unitId)) return true;
  return units.some((unit) => unit.parent_id === unitId && unitCoversVisible(unit.id, visibleIds, units));
}

export function unitSelectionFromVisibleIds(
  unitIds: string[],
  units: Unit[],
): Pick<ExportSettingsState, 'department_ids' | 'module_ids'> {
  const visibleIds = new Set(unitIds.filter(Boolean));
  if (!visibleIds.size) return { department_ids: [], module_ids: [] };
  return {
    department_ids: units
      .filter((unit) => !unit.parent_id && unitCoversVisible(unit.id, visibleIds, units))
      .map((unit) => unit.id),
    module_ids: [],
  };
}

function uniqueStatuses(values: RequestStatus[], allowed: RequestStatus[]): RequestStatus[] {
  return allowed.filter((status) => values.includes(status));
}

export function exportSettingsFromRequestPage(options: {
  user: User;
  filters: { status: string; frozen: string; flow?: '' | 'expense' | 'income' };
  visibleRequests: BudgetRequest[];
  units: Unit[];
}): ExportSettingsState {
  const allowed = CLOSED_EXPORT_STATUSES;
  const pageStatus = options.filters.status as RequestStatus;
  const statuses = allowed.includes(pageStatus)
    ? [pageStatus]
    : uniqueStatuses(options.visibleRequests.map((request) => request.status), allowed);
  const unitIds = [...new Set(options.visibleRequests.map((request) => request.unit_id).filter(Boolean))];
  const department_ids: string[] = [];
  const module_ids: string[] = [];
  unitIds.forEach((unitId) => {
    const selection = unitSelectionFromId(unitId, options.units);
    department_ids.push(...selection.department_ids);
    module_ids.push(...selection.module_ids);
  });
  return {
    ...defaultExportSettings(options.user),
    statuses: statuses.length ? statuses : [...EXPORTABLE_REQUEST_STATUSES],
    fixed_only: options.filters.frozen === 'fixed',
    export_kind: options.filters.flow || 'all',
    department_ids: [...new Set(department_ids)],
    module_ids: [...new Set(module_ids)],
  };
}

export function exportSettingsFromRegister(options: {
  user: User;
  flow?: '' | 'expense' | 'income';
  requestStatus?: string;
  cfoId?: string;
  visibleRequestStatuses?: string[];
  visibleUnitIds?: string[];
  units?: Unit[];
}): ExportSettingsState {
  const allowed = REGISTER_EXPORT_STATUSES;
  const pageStatus = options.requestStatus as RequestStatus;
  const visible = uniqueStatuses((options.visibleRequestStatuses || []) as RequestStatus[], allowed);
  const units = options.units || [];
  const unitScope = options.cfoId
    ? unitSelectionFromId(options.cfoId, units)
    : unitSelectionFromVisibleIds(options.visibleUnitIds || [], units);
  return {
    ...defaultExportSettings(options.user, true),
    statuses: allowed.includes(pageStatus) ? [pageStatus] : (visible.length ? visible : [...allowed]),
    export_kind: options.flow || 'all',
    department_ids: unitScope.department_ids,
    module_ids: unitScope.module_ids,
    include_files: true,
  };
}
