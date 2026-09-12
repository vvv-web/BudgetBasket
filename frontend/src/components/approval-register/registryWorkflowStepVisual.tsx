import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SvgIconComponent } from '@mui/icons-material';
import type { RegisterStepDecisionDisplay } from '../../types';
import type { StatusVisualVariant } from './registryStatusVisual';
import { StatusVisualBadge } from './registryStatusVisual';

const TONE_VARIANT: Record<RegisterStepDecisionDisplay['tone'], StatusVisualVariant> = {
  success: 'success',
  error: 'error',
  warning: 'revision',
  info: 'info',
  action: 'action',
  default: 'neutral',
};

const TONE_ICON: Record<RegisterStepDecisionDisplay['tone'], SvgIconComponent> = {
  success: CheckCircleOutlineIcon,
  error: CancelOutlinedIcon,
  warning: ErrorOutlineIcon,
  info: InfoOutlinedIcon,
  action: ErrorOutlineIcon,
  default: ScheduleOutlinedIcon,
};

export function WorkflowStepStatusIcon({ display }: { display?: RegisterStepDecisionDisplay | null }) {
  if (!display) {
    return <ScheduleOutlinedIcon sx={{ fontSize: 16, color: '#94A3B8' }} />;
  }

  const spec = {
    text: display.label,
    variant: TONE_VARIANT[display.tone],
    icon: TONE_ICON[display.tone],
    hint: display.hint,
  };
  const iconOnly = display.ready && display.tone === 'action' || display.tone !== 'default' && display.tone !== 'info';

  return <StatusVisualBadge spec={spec} iconOnly={iconOnly} />;
}

export function WorkflowStepCell({ display }: { display?: RegisterStepDecisionDisplay | null }) {
  if (!display) {
    return <Typography variant="body2" sx={{ fontSize: 13 }}>—</Typography>;
  }

  const spec = {
    text: display.label,
    variant: TONE_VARIANT[display.tone],
    icon: TONE_ICON[display.tone],
    hint: display.hint,
  };
  const iconOnly = display.ready && display.tone === 'action';

  const content = (
    <Box sx={{ minWidth: 0, maxWidth: '100%', py: 0.15 }}>
      <StatusVisualBadge spec={spec} iconOnly={iconOnly} />
    </Box>
  );
  const tooltip = display.hint || display.label;
  return tooltip ? <Tooltip title={tooltip} arrow placement="top">{content}</Tooltip> : content;
}
