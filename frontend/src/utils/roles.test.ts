import { describe, expect, it } from 'vitest';
import { canAccessApproval, defaultRouteForRole } from './roles';

describe('role guards', () => {
  it('allows only administrators into the route editor', () => {
    expect(canAccessApproval('admin')).toBe(true);
    expect(canAccessApproval('economist')).toBe(false);
    expect(canAccessApproval('approver')).toBe(false);
    expect(canAccessApproval('zgd')).toBe(false);
    expect(canAccessApproval('employee')).toBe(false);
  });

  it('opens business roles on their primary workspace', () => {
    expect(defaultRouteForRole('employee')).toBe('/requests');
    expect(defaultRouteForRole('approver')).toBe('/requests');
    expect(defaultRouteForRole('zgd')).toBe('/requests');
    expect(defaultRouteForRole('economist')).toBe('/');
    expect(defaultRouteForRole('admin')).toBe('/');
  });
});
