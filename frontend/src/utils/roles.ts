import type { Role } from '../types';

export const approvalRoles: Role[] = ['admin', 'economist', 'employee', 'approver', 'zgd'];

export function canAccessApproval(role: Role): boolean {
  return approvalRoles.includes(role);
}

/** Employee access to this register is limited to CFO responsibles by RequestsPage. */
export function canUseRegisterApprovalMode(role: Role): boolean {
  return role === 'employee' || role === 'economist' || role === 'approver' || role === 'zgd';
}

export function defaultRouteForRole(role: Role): string {
  if (role === 'employee' || role === 'economist') return '/requests';
  return '/';
}
