import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { ApprovalRegisterRow, ItemStatus, RegisterStepDecisionDisplay } from '../../types';
import { money } from '../../utils/labels';
import { InlineEditMoneyCell } from '../inlineEdit';
import {
  EditableRegistryStatusCell,
  type RegistryRowDecision,
} from './RegistryStatusCell';
import { parseMoneyInput, type RegistryStatusDisplay } from './registryConfig';
import { WorkflowStepStatusIcon } from './registryWorkflowStepVisual';

function compactStatus(status: ItemStatus | 'on_revision' | null | undefined, waiting: boolean): RegistryStatusDisplay {
  if (waiting) {
    return {
      label: 'Ожидает вашего решения',
      tone: 'warning',
      hint: 'Согласуйте сумму или верните на доработку',
    };
  }
  if (status === 'approved') {
    return { label: 'Утверждено', tone: 'success', hint: 'Согласовано' };
  }
  if (status === 'approved_with_changes') {
    return { label: 'Утверждено с изменениями', tone: 'success', hint: 'Согласовано с корректировкой' };
  }
  if (status === 'rejected') {
    return { label: 'Отклонено', tone: 'error', hint: 'Бюджет не выделен' };
  }
  if (status === 'on_revision') {
    return { label: 'На доработке', tone: 'warning', hint: 'Строка отмечена для возврата на доработку' };
  }
  return { label: 'Ожидает вашего решения', tone: 'warning', hint: 'Ожидает решения' };
}

function stepAmountLabel(display?: RegisterStepDecisionDisplay | null) {
  if (display?.amount != null) return money(display.amount);
  return '—';
}

export function RegistryPreviousStepCell({ display }: { display?: RegisterStepDecisionDisplay | null }) {
  const hint = display?.hint || display?.label || '';
  return (
    <Tooltip title={hint || 'Решение предыдущего шага'} arrow placement="top">
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        spacing={0.35}
        sx={{ minWidth: 0, maxWidth: '100%' }}
      >
        <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
          {stepAmountLabel(display)}
        </Typography>
        <WorkflowStepStatusIcon display={display} />
      </Stack>
    </Tooltip>
  );
}

export function RegistryYourDecisionCell({
  item,
  active,
  amountEditable,
  onCommit,
  onDecision,
}: {
  item: ApprovalRegisterRow;
  active: boolean;
  amountEditable: boolean;
  onCommit: (decision: RegistryRowDecision, amount: number) => void;
  onDecision: (decision: RegistryRowDecision, amount: number) => void;
}) {
  const display = item.status_context?.your_step;
  const resolvedAmount = display?.amount ?? item.approved_sum ?? item.requested_sum;
  const [amount, setAmount] = useState(resolvedAmount);

  useEffect(() => {
    setAmount(display?.amount ?? item.approved_sum ?? item.requested_sum);
  }, [display?.amount, item.approved_sum, item.requested_sum, item.id]);

  const statusDisplay = compactStatus(
    display?.item_status || item.status,
    Boolean(active || display?.ready),
  );

  const commitAmount = (nextAmount: number) => {
    setAmount(nextAmount);
    if (nextAmount === item.requested_sum) {
      onCommit('approved', nextAmount);
      return;
    }
    // Backend requires a comment for amount changes — open the existing dialog.
    onDecision('approved_with_changes', nextAmount);
  };

  const commitStatus = (decision: RegistryRowDecision) => {
    if (decision === 'rejected' || decision === 'approved_with_changes' || decision === 'on_revision') {
      onDecision(decision, amount);
      return;
    }
    setAmount(item.requested_sum);
    onCommit('approved', item.requested_sum);
  };

  if (!active) {
    const content = (
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        spacing={0.35}
        sx={{ minWidth: 0, maxWidth: '100%' }}
      >
        <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
          {stepAmountLabel(display)}
        </Typography>
        <Box sx={{ flex: '0 0 auto' }}>
            <EditableRegistryStatusCell
            status={statusDisplay}
            item={item}
            active={false}
            compact
            onCommit={commitStatus}
              onDecision={(decision) => onDecision(decision, amount)}
          />
        </Box>
      </Stack>
    );
    return content;
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="flex-end"
      spacing={0.35}
      sx={{ minWidth: 0, maxWidth: '100%' }}
      onClick={(event) => event.stopPropagation()}
    >
      <InlineEditMoneyCell
        value={amount}
        editable={amountEditable}
        formatValue={money}
        parseValue={parseMoneyInput}
        validate={(next) => next >= 0}
        ariaLabel="Сумма вашего решения"
        tooltip="Изменить сумму согласования"
        onCommit={commitAmount}
      />
      <Box sx={{ flex: '0 0 auto' }}>
        <EditableRegistryStatusCell
          status={statusDisplay}
          item={item}
          active
          compact
          onCommit={commitStatus}
          onDecision={(decision) => onDecision(decision, amount)}
        />
      </Box>
    </Stack>
  );
}
