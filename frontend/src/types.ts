export type Role = 'admin' | 'economist' | 'employee' | 'approver' | 'zgd';
export type RequestStatus = 'draft' | 'on_review' | 'approved' | 'approved_with_changes' | 'partially_approved' | 'rejected' | 'cancelled';
export type ItemStatus = 'on_review' | 'rejected' | 'approved_with_changes' | 'approved' | 'deleted';
export type StepStatus = 'waiting' | 'on_approval' | 'on_revision' | 'approved' | 'closed';

export interface User {
  id: string;
  login: string;
  role: Role;
  profile?: Profile;
  unit_ids?: string[];
}

export interface Profile {
  user_id: string;
  name: string;
  second_name: string;
  last_name: string;
  phone: string;
  email: string;
  max_link: string;
}

export interface Unit {
  id: string;
  parent_id: string | null;
  name: string;
  type?: 'department' | 'module';
  is_active: boolean;
  uses_invest_projects: boolean;
  annual_budget: number;
  children?: Unit[];
}

export interface CatalogItem {
  id: string;
  parent_id: string | null;
  unit_id: string | null;
  name: string;
  is_active: boolean;
}

export interface BudgetRequest {
  id: string;
  economist_id: string | null;
  unit_id: string;
  sum: number;
  status: RequestStatus;
  frozen: boolean;
  fixed: boolean;
  total_approved_sum?: number;
  summary?: RequestSummary;
  package_id?: string;
  package_name?: string;
  my_step_statuses?: MyApprovalStepStatus[];
}

export interface MyApprovalStepStatus {
  step_id: string;
  status: StepStatus;
  reviewed: boolean;
}

export interface RequestSummary {
  request_id: string;
  planned_sum: number;
  approved_sum: number;
  income_planned_sum: number;
  income_approved_sum: number;
  items_count: number;
  accepted_count: number;
  rejected_count: number;
  in_review_count: number;
}

export interface BudgetItem {
  id: string;
  request_id: string;
  dds_id?: string;
  invest_id?: string;
  is_income: boolean;
  sum_plan: number;
  sum_fact: number | null;
  name: string;
  justification: string;
  status: ItemStatus;
  comment: string | null;
}

export interface FileAttachment {
  id: number;
  id_storage_object: number;
  original_name: string;
}

export interface ApprovalStep {
  id: string;
  user_id: string;
  unit_id: string | null;
  status: StepStatus;
  user: User | null;
  unit: Unit | null;
  cfo: Unit | null;
  department: Unit | null;
  unit_path: string[];
  responsible: User | null;
  parent_step_ids: string[];
  child_step_ids: string[];
  request_status?: StepStatus;
  active_requests_count?: number;
}

export interface StepRequest extends BudgetRequest {
  unit: Unit | null;
  approval_status: StepStatus;
  reviewed_at_step?: boolean;
  items_count: number;
  reviewed_items_count: number;
  sum_plan: number;
  sum_fact: number;
  package_id?: string;
  package_name?: string;
}

export interface StepLog {
  id: number;
  step_id: string | null;
  user_id: string;
  created_at: string;
  user: User | null;
  log: {
    action: string;
    entity: string;
    entity_id: string;
    event_id: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
    comment?: string | null;
    child_step_id?: string;
    request_ids?: string[];
    targets?: { child_step_id: string; request_ids: string[] }[];
  };
}

export const CLOSED_REQUEST_STATUSES: RequestStatus[] = ['approved', 'approved_with_changes', 'partially_approved', 'rejected', 'cancelled'];
export const EXPORTABLE_REQUEST_STATUSES: RequestStatus[] = ['approved', 'approved_with_changes', 'partially_approved'];
