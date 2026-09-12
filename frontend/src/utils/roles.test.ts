import { describe, expect, it } from 'vitest';
import { canAccessApproval, canUseRegisterApprovalMode, defaultRouteForRole } from './roles';

describe('role guards', () => {
  it('limits the register approval mode to workflow participants', () => {
    expect(canUseRegisterApprovalMode('employee')).toBe(true);
    expect(canUseRegisterApprovalMode('economist')).toBe(true);
    expect(canUseRegisterApprovalMode('approver')).toBe(true);
    expect(canUseRegisterApprovalMode('zgd')).toBe(true);
    expect(canUseRegisterApprovalMode('admin')).toBe(false);
  });

  it('allows workflow participants into the approval workspace', () => {
    expect(canAccessApproval('admin')).toBe(true);
    expect(canAccessApproval('economist')).toBe(true);
    expect(canAccessApproval('employee')).toBe(true);
    expect(canAccessApproval('approver')).toBe(true);
    expect(canAccessApproval('zgd')).toBe(true);
  });

  it('opens business roles on their primary workspace', () => {
    expect(defaultRouteForRole('employee')).toBe('/requests');
    expect(defaultRouteForRole('economist')).toBe('/requests');
    expect(defaultRouteForRole('approver')).toBe('/');
    expect(defaultRouteForRole('zgd')).toBe('/');
    expect(defaultRouteForRole('admin')).toBe('/');
  });
});
