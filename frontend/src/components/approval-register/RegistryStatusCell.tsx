import type { ReactNode } from 'react';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ApprovalRegisterRow, RegisterAggregates, RegisterStepDecisionDisplay } from '../../types';
import type { RegistryStatusDisplay } from './registryConfig';
import { InlineEditSelectCell } from '../inlineEdit';
import {
  groupStatusPresentation,
  rowStatusPresentation,
  StatusVisualCell,
} from './registryStatusVisual';
import { WorkflowStepCell } from './registryWorkflowStepVisual';

export type RegistryRowDecision = 'approved' | 'approved_with_changes' | 'rejected' | 'on_revision';
type RegistryStatusAction = '' | RegistryRowDecision;

const STATUS_EDIT_OPTIONS: Array<{ value: RegistryStatusAction; label: string }> = [
  { value: '', label: 'Выберите действие' },
  { value: 'approved', label: 'Согласовать' },
  { value: 'rejected', label: 'Отклонить' },
  { value: 'on_revision', label: 'На доработку' },
];

function statusActionHint(item: ApprovalRegisterRow, active: boolean) {
  if (item.fixed) return 'Действия недоступны';
  if (item.is_revision_actionable) return 'Действие: исправить и повторно отправить';
  if (item.is_module_revision) return null;
  if (item.is_position_submission_actionable) return 'Действие: передать экономисту';
  if (item.is_decision_editable) return 'Действие: изменить решение до передачи строки на следующий этап';
  if (active) return 'Действие: согласовать или отклонить';
  return null;
}

function StatusWithLifecycle({
  item,
  active,
  children,
}: {
  item: ApprovalRegisterRow;
  active: boolean;
  children: ReactNode;
}) {
  const actionHint = statusActionHint(item, active);
  return (
    <Stack spacing={0.35} sx={{ minWidth: 0 }}>
      {children}
      {item.frozen && !item.fixed && (
        <Tooltip title="Заморожено: изменение строки недоступно" arrow>
          <LockOutlinedIcon aria-label="Заморожено" sx={{ fontSize: 16, color: 'info.main', ml: 0.25 }} />
        </Tooltip>
      )}
      {actionHint && <Typography variant="caption" color={active ? 'warning.dark' : 'text.secondary'} sx={{ fontSize: 10, lineHeight: 1.2 }}>{actionHint}</Typography>}
    </Stack>
  );
}

export function RegistryStatusCell({
  status,
  item,
  onPrimaryAction,
  primaryActionLabel,
  primaryActionDisabled,
}: {
  status: RegistryStatusDisplay;
  item?: ApprovalRegisterRow;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
}) {
  return (
    <StatusVisualCell
      presentation={rowStatusPresentation(status, item)}
      primaryAction={onPrimaryAction && primaryActionLabel
        ? { onClick: onPrimaryAction, ariaLabel: primaryActionLabel, disabled: primaryActionDisabled }
        : undefined}
    />
  );
}

export function RegistryGroupStatusCell({ status, aggregates }: { status: RegistryStatusDisplay; aggregates: RegisterAggregates }) {
  return <StatusVisualCell presentation={groupStatusPresentation(aggregates, status)} />;
}

export function RegistryWorkflowStepCell({ display }: { display?: RegisterStepDecisionDisplay | null }) {
  return <WorkflowStepCell display={display} />;
}

export function EditableRegistryStatusCell({
  status,
  item,
  active,
  onCommit,
  onDecision,
  compact = false,
}: {
  status: RegistryStatusDisplay;
  item: ApprovalRegisterRow;
  active: boolean;
  onCommit: (decision: RegistryRowDecision) => void;
  onDecision: (decision: RegistryRowDecision) => void;
  compact?: boolean;
}) {
  const presentation = compact
    ? {
        primary: {
          ...rowStatusPresentation(status, item).primary,
          text: status.label === 'Ожидает вашего решения' ? '!' : rowStatusPresentation(status, item).primary.text,
        },
        hint: status.hint,
        primaryIconOnly: true,
        showActionIndicator: false,
      }
    : rowStatusPresentation(status, item);

  if (!active) {
    return <StatusWithLifecycle item={item} active={false}><StatusVisualCell presentation={presentation} /></StatusWithLifecycle>;
  }

  return (
    <StatusWithLifecycle item={item} active>
      <InlineEditSelectCell
        value=""
        editable
        options={item.is_final_approval_actionable || item.decision_editable_stage === 'approver'
          ? STATUS_EDIT_OPTIONS.filter((option) => option.value !== 'rejected' && option.value !== 'on_revision')
          : STATUS_EDIT_OPTIONS}
        display={<StatusVisualCell presentation={presentation} disableTooltip />}
        ariaLabel="Статус и действие по строке"
        tooltip="Выберите доступное действие по строке"
        onCommit={(decision) => {
          if (!decision) return;
          if (decision === 'rejected') {
            onDecision(decision);
            return;
          }
          onCommit(decision);
        }}
      />
    </StatusWithLifecycle>
  );
}
