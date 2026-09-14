import { describe, expect, it } from 'vitest';
import type { BudgetRequest, Unit, User } from '../types';
import { exportSettingsFromRegister, exportSettingsFromRequestPage } from './exportSettings';

const user = { id: 'u1', login: 'employee', role: 'employee' } as User;
const department: Unit = {
  id: 'dept-1', parent_id: null, name: 'Департамент', is_active: true, uses_invest_projects: false, annual_budget: 0,
};
const module: Unit = {
  id: 'mod-1', parent_id: 'dept-1', name: 'Модуль', is_active: true, uses_invest_projects: false, annual_budget: 0, type: 'module',
};

describe('export settings from page filters', () => {
  it('copies request-list status and fixed filters', () => {
    const settings = exportSettingsFromRequestPage({
      user,
      filters: { status: 'approved', frozen: 'fixed' },
      visibleRequests: [{ id: 'r1', unit_id: 'mod-1', status: 'approved' } as BudgetRequest],
      units: [department, module],
    });
    expect(settings.statuses).toEqual(['approved']);
    expect(settings.fixed_only).toBe(true);
    expect(settings.module_ids).toEqual(['mod-1']);
  });

  it('copies register request status and CFO into the dialog', () => {
    const settings = exportSettingsFromRegister({
      user: { ...user, role: 'admin' },
      requestStatus: 'on_review',
      cfoId: 'dept-1',
      visibleRequestStatuses: ['on_review', 'approved'],
      units: [department, module],
    });
    expect(settings.statuses).toEqual(['on_review']);
    expect(settings.department_ids).toEqual(['dept-1']);
    expect(settings.module_ids).toEqual([]);
    expect(settings.include_files).toBe(true);
  });

  it('maps a nested register unit to a module checkbox', () => {
    const settings = exportSettingsFromRegister({
      user: { ...user, role: 'admin' },
      cfoId: 'mod-1',
      units: [department, module],
    });
    expect(settings.department_ids).toEqual([]);
    expect(settings.module_ids).toEqual(['mod-1']);
  });

  it('checks departments that cover visible register rows', () => {
    const otherDepartment: Unit = { ...department, id: 'dept-2', name: 'Другое' };
    const otherModule: Unit = { ...module, id: 'mod-2', parent_id: 'dept-2', name: 'Другой модуль' };
    const unused: Unit = { ...module, id: 'mod-3', parent_id: 'dept-1', name: 'Без строк' };
    const settings = exportSettingsFromRegister({
      user: { ...user, role: 'admin' },
      visibleUnitIds: ['mod-1', 'mod-2'],
      units: [department, module, otherDepartment, otherModule, unused],
    });
    expect(settings.department_ids).toEqual(['dept-1', 'dept-2']);
    expect(settings.module_ids).toEqual([]);
  });
});
