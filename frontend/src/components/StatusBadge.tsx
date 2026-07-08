import Chip from '@mui/material/Chip';
import type { ItemStatus, RequestStatus } from '../types';
import { itemStatusLabels, requestStatusLabels } from '../utils/labels';

const colors: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  draft: 'default',
  submitted: 'info',
  in_review: 'warning',
  fixed: 'success',
  unfrozen: 'primary',
  cancelled: 'error',
  rejected: 'error',
  accepted_adjusted: 'primary',
  accepted: 'success',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Chip size="small" color={colors[status]} label={requestStatusLabels[status]} />;
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <Chip size="small" color={colors[status]} label={itemStatusLabels[status]} />;
}
