import type { Role } from '../types';

export const approvalRoles: Role[] = ['admin', 'economist', 'employee', 'approver', 'zgd'];

export function canAccessApproval(role: Role): boolean {
  return approvalRoles.includes(role);
}

export function defaultRouteForRole(role: Role): string {
  if (role === 'employee') return '/requests';
  if (role === 'approver' || role === 'zgd') return '/requests';
  return '/';
}
