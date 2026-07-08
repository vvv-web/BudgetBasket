export type Role = 'admin' | 'economist' | 'employee';
export type RequestStatus = 'draft' | 'submitted' | 'in_review' | 'fixed' | 'unfrozen' | 'cancelled';
export type ItemStatus = 'in_review' | 'rejected' | 'accepted_adjusted' | 'accepted';

export interface User {
  id: string;
  login: string;
  role: Role;
  is_active: boolean;
  profile?: Profile;
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
  budget_year?: number;
  total_approved_sum?: number;
  summary?: RequestSummary;
}

export interface RequestSummary {
  request_id: string;
  planned_sum: number;
  approved_sum: number;
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
  category_id: string | null;
  sum_plan: number;
  sum_fact: number | null;
  status: ItemStatus;
  comment: string | null;
}
