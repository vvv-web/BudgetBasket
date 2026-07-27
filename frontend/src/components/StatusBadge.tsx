import Chip from '@mui/material/Chip';
import type { ItemStatus, RequestStatus, StepStatus } from '../types';
import { itemStatusLabels, requestStatusLabels, stepStatusLabels } from '../utils/labels';

const styles: Record<string, { bgcolor: string; color: string; border: string }> = {
  draft: { bgcolor: '#F3F4F6', color: '#6B7280', border: '#E5E7EB' },
  on_review: { bgcolor: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
  approved: { bgcolor: '#ECFDF5', color: '#059669', border: '#A7F3D0' },
  partially_approved: { bgcolor: '#EAF1FF', color: '#2F6FED', border: '#BFDBFE' },
  rejected: { bgcolor: '#FEF2F2', color: '#DC2626', border: '#FECACA' },
  cancelled: { bgcolor: '#FEF2F2', color: '#DC2626', border: '#FECACA' },
  approved_with_changes: { bgcolor: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  deleted: { bgcolor: '#F3F4F6', color: '#6B7280', border: '#E5E7EB' },
  waiting: { bgcolor: '#F3F4F6', color: '#6B7280', border: '#E5E7EB' },
  on_approval: { bgcolor: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  on_revision: { bgcolor: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  closed: { bgcolor: '#ECFDF5', color: '#047857', border: '#A7F3D0' },
};

function StatusChip({ status, label }: { status: string; label: string }) {
  const tone = styles[status] || styles.draft;
  return (
    <Chip
      size="small"
      label={label}
      variant="outlined"
      sx={{
        bgcolor: tone.bgcolor,
        color: tone.color,
        borderColor: tone.border,
        fontWeight: 600,
      }}
    />
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <StatusChip status={status} label={requestStatusLabels[status]} />;
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <StatusChip status={status} label={itemStatusLabels[status]} />;
}

export function StepStatusBadge({ status, label }: { status: StepStatus; label?: string }) {
  return <StatusChip status={status} label={label || stepStatusLabels[status]} />;
}
