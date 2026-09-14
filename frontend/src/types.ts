export type Role = 'admin' | 'economist' | 'employee' | 'approver' | 'zgd';
export type RequestStatus = 'draft' | 'on_review' | 'approved' | 'rejected' | 'cancelled';
export type ItemStatus = 'on_review' | 'rejected' | 'approved_with_changes' | 'approved' | 'deleted';
export type StepStatus = 'waiting' | 'on_approval' | 'on_revision' | 'approved' | 'closed';
export type CfoPositionStatus = 'waiting' | 'on_review' | 'on_approval' | 'approved' | 'on_revision';

export interface User {
  id: string;
  login: string;
  role: Role;
  profile?: Profile | null;
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
  type?: 'department' | 'cfo' | 'module';
  is_active: boolean;
  uses_invest_projects: boolean;
  annual_budget: number;
  has_active_request_items?: boolean;
  has_requests?: boolean;
  children?: Unit[];
}

export interface CatalogItem {
  id: string;
  parent_id: string | null;
  unit_id: string | null;
  name: string;
  is_active: boolean;
  can_delete?: boolean;
  delete_block_reason?: string | null;
}

export interface BudgetRequest {
  id: string;
  unit_id: string;
  budget_year: number;
  /** Display alias for legacy request lists; equals sum_plan. */
  sum: number;
  sum_plan: number;
  sum_fact: number;
  status: RequestStatus;
  /** Workflow flags live on CfoPosition; kept optional for old read-only widgets. */
  frozen?: boolean;
  fixed?: boolean;
  cfo_unit_id?: string;
  available_actions?: string[];
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
  cfo_position_id?: string | null;
  dds_id?: string;
  invest_id?: string;
  is_income: boolean;
  sum_plan: number;
  sum_fact: number | null;
  name: string;
  justification: string;
  status: ItemStatus;
  comment: string | null;
  frozen: boolean;
  fixed: boolean;
  analytics_1: string;
  analytics_2: string;
  analytics_3: string;
  analytics_4: string;
  analytics_5: string;
  month_plans: ItemMonthPlan[];
}

export type RegisterAggregateStatus = 'approved' | 'rejected' | 'partially_approved' | 'on_review' | 'in_progress' | 'no_data';

export interface RegisterAggregates {
  requested_sum: number;
  approved_sum: number;
  rejected_sum: number;
  pending_sum: number;
  difference: number;
  total_rows: number;
  approved_rows: number;
  rejected_rows: number;
  revision_rows?: number;
  /** Lines returned from the economist to the responsible CFO. */
  cfo_revision_rows?: number;
  pending_rows: number;
  requests_count: number;
  modules_count: number;
  aggregate_status: RegisterAggregateStatus;
  collecting_requests: number;
  /** Draft requests belonging to the same CFO, including modules without visible register rows. */
  cfo_unsubmitted_requests?: number;
  cfo_review_requests: number;
  cfo_review_actionable_requests: number;
  cfo_review_completable_requests: number;
  cfo_decision_editable_rows?: number;
  in_approval_positions: number;
  actionable_positions: number;
  /** Positions where the only current action is to submit them to the economist. */
  submission_positions?: number;
  /** Positions where the economist has reviewed every line and can pass the position on. */
  economist_completion_positions?: number;
  /** Positions whose current reviewer has decided every required line and can send the package. */
  workflow_ready_positions?: number;
  /** Positions where the economist has marked one or more lines for revision. */
  workflow_revision_positions?: number;
  /** Positions a reviewer may return to the immediately preceding route step. */
  workflow_return_positions?: number;
  /** Lines locked by ZGD; used to expose the reversible final lock control. */
  fixed_rows?: number;
  zgd_lock_positions?: number;
}

export interface RegisterGroupAnalyticsField {
  value: string;
  mixed: boolean;
}

export interface RegisterGroupAnalytics {
  can_edit: boolean;
  fields: Record<string, RegisterGroupAnalyticsField>;
}

export type RegisterGroupingLevel = 'cfo' | 'category' | 'article' | 'module' | 'request'
  | 'analytics_1' | 'analytics_2' | 'analytics_3' | 'analytics_4' | 'analytics_5';

export interface ApprovalRegisterGroup {
  has_children?: boolean;
  id: string;
  type: RegisterGroupingLevel;
  name: string;
  label: string;
  group_value?: string;
  module_id: string;
  article_id: string;
  category_id: string;
  /** Exact server-side filter scope of this grouping branch. */
  scope?: Partial<Record<RegisterGroupingLevel, string>>;
  request_ids: string[];
  aggregates: RegisterAggregates;
  /** Original aggregate before filters in table columns were applied. */
  source_aggregates?: RegisterAggregates;
  children: ApprovalRegisterGroup[];
  can_load_rows: boolean;
  analytics?: RegisterGroupAnalytics;
}

export interface RegisterAnalyticsSummaryValue {
  value: string;
  aggregates: RegisterAggregates;
  top_cfo: { cfo_id: string; cfo_name: string; requested_sum: number; total_rows: number };
}

export interface RegisterAnalyticsSummary {
  field: 'analytics_1' | 'analytics_2' | 'analytics_3' | 'analytics_4' | 'analytics_5';
  label: string;
  values: RegisterAnalyticsSummaryValue[];
}

export interface ApprovalRegisterResponse {
  visible_request_statuses?: string[];
  visible_unit_ids?: string[];
  matched_item_ids?: string[] | null;
  view: 'cfo' | 'category' | 'article' | 'module' | 'request';
  group_by?: RegisterGroupingLevel[];
  groups: ApprovalRegisterGroup[];
  aggregates: RegisterAggregates;
  analytics_summary?: RegisterAnalyticsSummary[];
  summary_items?: ApprovalRegisterRow[];
}

export interface RegisterLineStatusDecision {
  at: string;
  by_id?: string | null;
  by_name?: string | null;
  action: string;
  action_label: string;
  stage?: string | null;
  item_status?: ItemStatus | 'on_revision' | null;
}

export interface RegisterLineStatusOwner {
  by_id?: string | null;
  by_name?: string | null;
  role_label: string;
}

export interface RegisterLineEditability {
  can_decide: boolean;
  can_edit_amount: boolean;
  can_edit_analytics: boolean;
  mode: 'editable' | 'readonly' | 'locked';
  summary: string;
  detail: string;
}

export interface RegisterLineStatusContext {
  last_decision?: RegisterLineStatusDecision | null;
  current_owner?: RegisterLineStatusOwner | null;
  editability: RegisterLineEditability;
  previous_step?: RegisterStepDecisionDisplay | null;
  your_step?: RegisterStepDecisionDisplay | null;
}

export interface RegisterItemComment {
  id: string;
  comment: string;
  author_name?: string | null;
  author_role?: User['role'] | string | null;
  created_at?: string | null;
  action?: string;
  event_id?: string | null;
}

export interface RegisterStepDecisionDisplay {
  label: string;
  tone: 'success' | 'error' | 'warning' | 'info' | 'action' | 'default';
  hint: string;
  ready?: boolean;
  amount?: number | null;
  item_status?: ItemStatus | 'on_revision' | null;
}

export interface ApprovalRegisterRow {
  id: string;
  request_id: string;
  request_status: RequestStatus;
  budget_year: number;
  module_id: string;
  module_name: string;
  cfo_id: string;
  cfo_name: string;
  category_id: string;
  category_name: string;
  article_id: string;
  article_name: string;
  kind: 'dds' | 'invest';
  name: string;
  justification: string;
  comment: string;
  comment_history?: RegisterItemComment[];
  files_count: number;
  requested_sum: number;
  approved_sum: number;
  status: ItemStatus;
  updated_at: string;
  is_collecting: boolean;
  is_cfo_review: boolean;
  is_cfo_review_item_allowed?: boolean;
  is_cfo_review_actionable: boolean;
  is_decision_editable?: boolean;
  decision_editable_stage?: 'cfo_review' | 'economist' | 'approver' | null;
  is_cfo_review_completable?: boolean;
  is_revision?: boolean;
  is_module_revision?: boolean;
  is_cfo_revision_pending?: boolean;
  /** Line returned from the economist to the responsible CFO. */
  is_cfo_revision?: boolean;
  is_revision_actionable?: boolean;
  is_cfo_module_revision_actionable?: boolean;
  position_id: string | null;
  current_step_id?: string | null;
  is_in_approval: boolean;
  is_current_step_owner?: boolean;
  is_approval_actionable: boolean;
  is_final_approval_actionable?: boolean;
  is_position_actionable?: boolean;
  is_position_submission_actionable?: boolean;
  is_workflow_submission_actionable?: boolean;
  is_workflow_revision_actionable?: boolean;
  is_workflow_return_actionable?: boolean;
  is_workflow_revision_marked?: boolean;
  is_economist_completion_actionable?: boolean;
  is_zgd_lock_actionable?: boolean;
  approval_stage: string | null;
  frozen?: boolean;
  fixed?: boolean;
  analytics_1?: string;
  analytics_2?: string;
  analytics_3?: string;
  analytics_4?: string;
  analytics_5?: string;
  status_context?: RegisterLineStatusContext;
}

export interface ApprovalRegisterRowsResponse {
  items: ApprovalRegisterRow[];
  group: { module_id: string; aggregates: RegisterAggregates };
  pagination: { page: number; page_size: number; total_items: number; total_pages: number; has_next: boolean; has_previous: boolean };
}

export interface ItemMonthPlan {
  month: number;
  sum_plan: number | string;
}

export interface FileAttachment {
  id: number;
  id_storage_object: number;
  original_name: string;
  stored_name?: string;
  is_sanitized?: boolean;
  sanitization_report?: {
    removed?: string[];
    warnings?: string[];
  } | null;
}

export interface ApprovalStep {
  id: string;
  user_id: string | null;
  unit_id: string | null;
  status: StepStatus;
  user: User | null;
  unit: Unit | null;
  cfo: Unit | null;
  department: Unit | null;
  is_economist_step?: boolean;
  cfo_unit_id?: string | null;
  cfo_unit_ids?: string[];
  cfo_names?: string[];
  unit_path: string[];
  responsible: User | null;
  modules?: Array<{
    id: string;
    name: string;
    responsible: User | null;
    request_statuses: Array<{
      status: RequestStatus;
      count: number;
    }>;
  }>;
  parent_step_ids: string[];
  child_step_ids: string[];
  request_status?: StepStatus;
  active_positions_count?: number;
  revision_positions_count?: number;
  active_requests_count?: number;
  readiness?: {
    needs_line_decisions: number;
    awaiting_return_confirmation: number;
    needs_revision: number;
    ready_for_next_action: number;
  };
}

export interface CfoPosition {
  id: string;
  budget_year: number;
  cfo_unit_id: string;
  dds_id?: string | null;
  invest_id?: string | null;
  status: CfoPositionStatus;
  current_step_id: string | null;
  frozen_items_count: number;
  fixed_items_count: number;
  open_items_count: number;
  all_items_frozen: boolean;
  all_items_fixed: boolean;
  can_forward: boolean;
  sum_plan: number;
  sum_fact: number;
  items_count: number;
  cfo?: Unit | null;
  article?: CatalogItem | null;
  current_step?: ApprovalStep | null;
  contributions: Array<BudgetItem & {
    request: BudgetRequest;
    module?: Unit | null;
    author?: User | null;
  }>;
}

export interface CfoPositionComment {
  id: number;
  created_at: string;
  comment: string;
  step_id: string | null;
  user: User | null;
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

export interface RequestLog {
  id: number;
  created_at: string;
  source?: 'request' | 'cfo_position';
  request_id?: string;
  request_unit_name?: string | null;
  user: { id: string; login: string; role: Role; profile?: Profile | null } | null;
  subject: { type: 'request_line'; name: string | null; article: string | null; category: string | null } | null;
  log: {
    action: string;
    entity: string;
    entity_id?: string;
    event_id?: string;
    cfo_position_id?: string;
    step_id?: string;
    req_item_id?: string;
    item_ids?: string[];
    request_ids?: string[];
    item_contexts?: Array<{ id: string; name: string | null; request_id: string; request_unit_name?: string | null }>;
    decision?: ItemStatus;
    agreed_sum?: number | string | null;
    comment?: string | null;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
}

export const CLOSED_REQUEST_STATUSES: RequestStatus[] = ['approved', 'rejected', 'cancelled'];
export const EXPORTABLE_REQUEST_STATUSES: RequestStatus[] = ['approved'];
