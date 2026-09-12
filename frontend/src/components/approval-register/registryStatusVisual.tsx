import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SvgIconComponent } from '@mui/icons-material';
import type { ApprovalRegisterRow, RegisterAggregates } from '../../types';
import type { RegistryStatusDisplay } from './registryConfig';
import { lineStatusFootnote, lineStatusTooltipLines } from './registryLineContext';

export type StatusVisualVariant = 'action' | 'success' | 'error' | 'info' | 'revision' | 'neutral' | 'muted';

export type StatusVisualSpec = {
  text: string;
  variant: StatusVisualVariant;
  icon: SvgIconComponent;
  hint: string;
};

export type StatusVisualPresentation = {
  primary: StatusVisualSpec;
  meta?: string;
  footnote?: string;
  tooltipLines?: string[];
  hint: string;
  primaryIconOnly?: boolean;
  showActionIndicator?: boolean;
};

export function rowNeedsUserDecision(item?: ApprovalRegisterRow) {
  return item?.status_context?.editability?.can_decide ?? false;
}

const BADGE_HEIGHT = 24;
const ICON_SIZE = 14;

const BADGE_SHELL = {
  bgcolor: '#FFFFFF',
  border: '#D7DEE8',
};

const VARIANT_INK: Record<StatusVisualVariant, string> = {
  action: '#EA580C',
  success: '#16A34A',
  error: '#DC2626',
  info: '#2563EB',
  revision: '#B45309',
  neutral: '#64748B',
  muted: '#94A3B8',
};

export const STATUS_LEGEND_SPECS: StatusVisualSpec[] = [
  { icon: CheckCircleOutlineIcon, text: 'Согласовано', variant: 'success', hint: '' },
  { icon: CancelOutlinedIcon, text: 'Отклонено', variant: 'error', hint: '' },
  { icon: ErrorOutlineIcon, text: 'Ваше решение', variant: 'action', hint: '' },
  { icon: RestartAltOutlinedIcon, text: 'На доработке', variant: 'revision', hint: '' },
  { icon: ScheduleOutlinedIcon, text: 'Ожидание', variant: 'neutral', hint: '' },
  { icon: EditNoteOutlinedIcon, text: 'Черновик', variant: 'muted', hint: '' },
];

function workflowMeta(item?: ApprovalRegisterRow) {
  if (!item?.approval_stage) return undefined;
  if (item.approval_stage.includes('экономист')) return 'Этап: экономист ЦФО';
  if (item.approval_stage.includes('ЗГД')) return 'Этап: финальное согласование';
  return `Этап: ${item.approval_stage}`;
}

function pluralRows(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'строка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'строки';
  return 'строк';
}

function groupMetaParts(aggregates: RegisterAggregates, options?: { excludeActionable?: boolean }) {
  const parts: string[] = [];
  const submissionPositions = aggregates.submission_positions || 0;
  const economistCompletionPositions = aggregates.economist_completion_positions || 0;
  const workflowReadyPositions = aggregates.workflow_ready_positions || 0;
  const workflowRevisionPositions = aggregates.workflow_revision_positions || 0;
  const decisions = aggregates.cfo_review_actionable_requests
    + Math.max(aggregates.actionable_positions - submissionPositions - economistCompletionPositions - workflowReadyPositions - workflowRevisionPositions, 0);
  const packagePositions = Math.max(workflowReadyPositions - economistCompletionPositions, 0);
  const actionable = decisions + submissionPositions + economistCompletionPositions + packagePositions + workflowRevisionPositions;

  if (!options?.excludeActionable && decisions > 0) {
    parts.push(`${decisions} требуют решения`);
  }
  if (!options?.excludeActionable && submissionPositions > 0) {
    parts.push(`${submissionPositions} готовы к передаче экономисту`);
  }
  if (!options?.excludeActionable && economistCompletionPositions > 0) {
    parts.push(`${economistCompletionPositions} готовы к передаче дальше`);
  }
  if (!options?.excludeActionable && packagePositions > 0) {
    parts.push(`${packagePositions} готовы к пакетной отправке`);
  }
  if (!options?.excludeActionable && workflowRevisionPositions > 0) {
    parts.push(`${workflowRevisionPositions} на доработку`);
  }
  if (aggregates.rejected_rows > 0) {
    parts.push(`${aggregates.rejected_rows} отклонено`);
  }
  const waiting = Math.max(aggregates.pending_rows - actionable, 0);
  if (waiting > 0) {
    parts.push(`${waiting} в очереди`);
  }
  if (aggregates.collecting_requests > 0) {
    parts.push(`${aggregates.collecting_requests} в черновике`);
  }
  return parts;
}

export function rowStatusPresentation(status: RegistryStatusDisplay, item?: ApprovalRegisterRow): StatusVisualPresentation {
  const hint = status.hint;
  const footnote = lineStatusFootnote(item);
  const tooltipLines = lineStatusTooltipLines(item);
  const withContext = (presentation: StatusVisualPresentation): StatusVisualPresentation => {
    const resolvedFootnote = footnote || presentation.footnote;
    const withDecisionMarkers: StatusVisualPresentation = {
      ...presentation,
      footnote: resolvedFootnote,
      tooltipLines: tooltipLines.length ? tooltipLines : presentation.tooltipLines,
      meta: resolvedFootnote || presentation.meta,
      primaryIconOnly: presentation.primaryIconOnly ?? false,
      showActionIndicator: false,
    };
    return withDecisionMarkers;
  };

  switch (status.label) {
    case 'Утверждено':
      return withContext({
        primary: { icon: CheckCircleOutlineIcon, text: 'Согласовано', variant: 'success', hint },
        meta: 'Решение принято',
        hint,
      });
    case 'Утверждено с изменениями':
      return withContext({
        primary: { icon: CheckCircleOutlineIcon, text: 'С изменениями', variant: 'success', hint },
        meta: 'Сумма скорректирована',
        hint,
      });
    case 'Отклонено':
      return withContext({
        primary: {
          icon: CancelOutlinedIcon,
          text: 'Отклонено',
          variant: 'error',
          hint,
        },
        meta: 'Бюджет по строке не выделен',
        hint,
      });
    case 'Черновик':
    case 'Не начато':
      return withContext({
        primary: { icon: EditNoteOutlinedIcon, text: 'Черновик', variant: 'muted', hint },
        meta: 'Не отправлено на проверку',
        hint,
      });
    case 'Удалена':
      return withContext({
        primary: { icon: BlockOutlinedIcon, text: 'Удалена', variant: 'muted', hint },
        meta: 'Строка исключена из заявки',
        hint,
      });
    case 'Заявка отменена':
      return withContext({
        primary: { icon: BlockOutlinedIcon, text: 'Отменено', variant: 'muted', hint },
        meta: 'Действия недоступны',
        hint,
      });
    case 'Заявка отклонена':
      return withContext({
        primary: { icon: CancelOutlinedIcon, text: 'Заявка отклонена', variant: 'error', hint },
        meta: 'На этапе проверки ЦФО',
        hint,
      });
    case 'Ожидает вашего решения':
      return withContext({
        primary: { icon: ErrorOutlineIcon, text: 'Ваше решение', variant: 'action', hint },
        meta: item?.is_cfo_review ? 'Проверка ответственным ЦФО' : workflowMeta(item) || 'Можно согласовать или вернуть',
        hint,
      });
    case 'Проверка ЦФО':
      return withContext({
        primary: { icon: SearchOutlinedIcon, text: 'На проверке ЦФО', variant: 'info', hint },
        meta: 'Ожидает ответственного ЦФО',
        hint,
      });
    case 'На доработке':
      return withContext({
        primary: { icon: RestartAltOutlinedIcon, text: 'На доработке', variant: 'revision', hint },
        meta: 'Ожидает исправлений автора',
        hint,
      });
    case 'Зафиксировано':
      return withContext({
        primary: { icon: LockOutlinedIcon, text: 'Зафиксировано', variant: 'neutral', hint },
        meta: 'Изменения недоступны',
        hint,
        primaryIconOnly: true,
      });
    case 'На согласовании':
      return withContext({
        primary: { icon: AccountTreeOutlinedIcon, text: 'На согласовании', variant: 'info', hint },
        meta: workflowMeta(item) || 'Ожидается решение другого участника маршрута',
        hint,
      });
    case 'Ожидает предыдущих этапов':
      return withContext({
        primary: { icon: AccountTreeOutlinedIcon, text: 'На согласовании', variant: 'info', hint },
        meta: workflowMeta(item) || 'Ожидает предыдущих этапов',
        hint,
      });
    case 'На рассмотрении':
      return withContext({
        primary: { icon: ScheduleOutlinedIcon, text: 'В очереди', variant: 'neutral', hint },
        meta: 'Ожидает решения в процессе',
        hint,
      });
    default:
      return withContext({
        primary: { icon: ScheduleOutlinedIcon, text: status.label, variant: 'neutral', hint },
        meta: status.shortHint,
        hint,
      });
  }
}

export function groupStatusPresentation(aggregates: RegisterAggregates, status: RegistryStatusDisplay): StatusVisualPresentation {
  const submissionPositions = aggregates.submission_positions || 0;
  const economistCompletionPositions = aggregates.economist_completion_positions || 0;
  const workflowReadyPositions = aggregates.workflow_ready_positions || 0;
  const cfoRevisionRows = aggregates.cfo_revision_rows || 0;
  const decisions = aggregates.cfo_review_actionable_requests
    + Math.max(aggregates.actionable_positions - submissionPositions - economistCompletionPositions - workflowReadyPositions, 0);
  const packagePositions = Math.max(workflowReadyPositions - economistCompletionPositions, 0);
  const hint = status.hint;
  const metaParts = groupMetaParts(aggregates, { excludeActionable: true });
  const meta = metaParts.length ? metaParts.join(' · ') : undefined;

  if (cfoRevisionRows > 0) {
    return {
      primary: { icon: RestartAltOutlinedIcon, text: 'На доработке', variant: 'revision', hint },
      meta: `${cfoRevisionRows} ${pluralRows(cfoRevisionRows)} возвращено экономистом ответственному ЦФО`,
      hint,
    };
  }

  if (decisions > 0) {
    return {
      primary: {
        icon: ErrorOutlineIcon,
        text: decisions === 1 ? 'Ваше решение' : `Ваше решение · ${decisions}`,
        variant: 'action',
        hint,
      },
      meta,
      hint,
    };
  }

  if (economistCompletionPositions > 0) {
    return {
      primary: {
        icon: AccountTreeOutlinedIcon,
        text: economistCompletionPositions === 1 ? 'Согласуйте и передайте' : `Согласуйте и передайте · ${economistCompletionPositions}`,
        variant: 'action',
        hint,
      },
      meta: meta || 'Все строки рассмотрены экономистом',
      hint,
    };
  }

  if (packagePositions > 0) {
    return {
      primary: {
        icon: AccountTreeOutlinedIcon,
        text: packagePositions === 1 ? 'Согласуйте и передайте' : `Согласуйте и передайте · ${packagePositions}`,
        variant: 'action',
        hint,
      },
      meta: meta || 'Все решения по строкам вынесены; позиция готова к пакетной отправке',
      hint,
    };
  }

  // Revision takes precedence over a handoff from another line in the group.
  if ((aggregates.revision_rows || 0) > 0 && !(aggregates.cfo_review_completable_requests || 0)) {
    return {
      primary: { icon: RestartAltOutlinedIcon, text: 'На доработке', variant: 'revision', hint },
      meta: `${aggregates.revision_rows} ${pluralRows(aggregates.revision_rows || 0)} возвращено`,
      hint,
    };
  }

  if (submissionPositions > 0) {
    return {
      primary: {
        icon: AccountTreeOutlinedIcon,
        text: submissionPositions === 1 ? 'Передайте экономисту' : `Передайте экономисту · ${submissionPositions}`,
        variant: 'action',
        hint,
      },
      meta: meta || 'Строки уже рассмотрены; редактирование не требуется',
      hint,
    };
  }

  if (aggregates.cfo_review_completable_requests > 0) {
    return {
      primary: {
        icon: ErrorOutlineIcon,
        text: aggregates.cfo_review_completable_requests === 1
          ? 'Завершите проверку'
          : `Завершите проверку · ${aggregates.cfo_review_completable_requests}`,
        variant: 'action',
        hint,
      },
      meta: meta || 'Строки проверены, заявки ещё не переданы в маршрут',
      hint,
    };
  }

  if ((aggregates.revision_rows || 0) > 0) {
    return {
      primary: { icon: RestartAltOutlinedIcon, text: 'На доработке', variant: 'revision', hint },
      meta: `${aggregates.revision_rows} ${pluralRows(aggregates.revision_rows || 0)} возвращено`,
      hint,
    };
  }

  if (aggregates.aggregate_status === 'approved') {
    return {
      primary: { icon: CheckCircleOutlineIcon, text: 'Согласовано', variant: 'success', hint },
      meta: `Все ${aggregates.total_rows} ${pluralRows(aggregates.total_rows)} согласованы`,
      hint,
    };
  }

  if (aggregates.aggregate_status === 'partially_approved') {
    return {
      primary: {
        icon: CheckCircleOutlineIcon,
        text: 'Частично рассмотрено',
        variant: 'info',
        hint,
      },
      meta: `${aggregates.approved_rows} согласовано · ${aggregates.rejected_rows} отклонено`,
      hint,
    };
  }

  if (aggregates.aggregate_status === 'rejected') {
    return {
      primary: { icon: CancelOutlinedIcon, text: 'Отклонено', variant: 'error', hint },
      meta: `${aggregates.rejected_rows} ${pluralRows(aggregates.rejected_rows)} отклонено`,
      hint,
    };
  }

  if (aggregates.rejected_rows > 0 && aggregates.pending_rows === 0 && aggregates.approved_rows === 0) {
    return {
      primary: { icon: CancelOutlinedIcon, text: 'Отклонено', variant: 'error', hint },
      meta: `${aggregates.rejected_rows} ${pluralRows(aggregates.rejected_rows)} отклонено`,
      hint,
    };
  }

  if (aggregates.collecting_requests > 0 && aggregates.collecting_requests === aggregates.requests_count) {
    return {
      primary: { icon: EditNoteOutlinedIcon, text: 'Черновик', variant: 'muted', hint },
      meta: 'Заявки не отправлены',
      hint,
    };
  }

  if (aggregates.collecting_requests > 0) {
    return {
      primary: { icon: EditNoteOutlinedIcon, text: 'Черновик', variant: 'muted', hint },
      meta: meta || status.shortHint,
      hint,
    };
  }

  if (aggregates.cfo_review_requests > 0) {
    return {
      primary: { icon: SearchOutlinedIcon, text: 'На проверке ЦФО', variant: 'info', hint },
      meta: `${aggregates.cfo_review_requests} заявок у ответственного`,
      hint,
    };
  }

  if (aggregates.in_approval_positions > 0) {
    const waiting = Math.max(aggregates.pending_rows, aggregates.in_approval_positions);
    return {
      primary: {
        icon: AccountTreeOutlinedIcon,
        text: waiting > 1 ? `На согласовании · ${waiting}` : 'На согласовании',
        variant: 'info',
        hint,
      },
      meta: meta || status.shortHint,
      hint,
    };
  }

  const fallback = rowStatusPresentation(status);
  return { ...fallback, meta: meta || fallback.meta };
}

function StatusIcon({ icon: Icon, color }: { icon: SvgIconComponent; color: string }) {
  return <Icon sx={{ fontSize: ICON_SIZE, color, flex: '0 0 auto' }} />;
}

export function StatusVisualBadge({ spec, iconOnly = false }: { spec: StatusVisualSpec; iconOnly?: boolean }) {
  const ink = VARIANT_INK[spec.variant];

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: iconOnly ? 'center' : 'flex-start',
        gap: iconOnly ? 0 : 0.45,
        width: iconOnly ? BADGE_HEIGHT : '100%',
        maxWidth: '100%',
        height: BADGE_HEIGHT,
        px: iconOnly ? 0 : 0.75,
        borderRadius: '4px',
        border: '1px solid',
        borderColor: BADGE_SHELL.border,
        bgcolor: BADGE_SHELL.bgcolor,
        color: ink,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        flex: iconOnly ? '0 0 auto' : undefined,
      }}
    >
      <StatusIcon icon={spec.icon} color={ink} />
      {!iconOnly ? <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{spec.text}</Box> : null}
    </Box>
  );
}

function ActionIndicatorIcon() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: BADGE_HEIGHT,
        height: BADGE_HEIGHT,
        borderRadius: '4px',
        border: '1px solid',
        borderColor: BADGE_SHELL.border,
        bgcolor: BADGE_SHELL.bgcolor,
        color: VARIANT_INK.action,
        flex: '0 0 auto',
      }}
    >
      <ErrorOutlineIcon sx={{ fontSize: ICON_SIZE }} />
    </Box>
  );
}

function StatusTooltip({ presentation }: { presentation: StatusVisualPresentation }) {
  const lines = presentation.tooltipLines?.length
    ? presentation.tooltipLines
    : [presentation.hint, presentation.meta].filter(Boolean) as string[];

  return (
    <Box sx={{ maxWidth: 320 }}>
      {lines.map((line, index) => (
        <Typography
          key={`${index}-${line}`}
          variant="caption"
          sx={{
            display: 'block',
            fontSize: 11,
            lineHeight: 1.35,
            color: index === 0 ? 'inherit' : 'rgba(255,255,255,0.82)',
            mt: index > 0 ? 0.5 : 0,
          }}
        >
          {line}
        </Typography>
      ))}
    </Box>
  );
}

export function StatusVisualCell({
  presentation,
  disableTooltip = false,
  primaryAction,
}: {
  presentation: StatusVisualPresentation;
  disableTooltip?: boolean;
  primaryAction?: { onClick: () => void; ariaLabel: string; disabled?: boolean };
}) {
  const showActionIndicator = presentation.showActionIndicator && !presentation.primaryIconOnly;
  const hasTooltip = Boolean(
    presentation.hint
    || presentation.meta
    || presentation.tooltipLines?.some(Boolean),
  );

  const badge = <StatusVisualBadge spec={presentation.primary} iconOnly={presentation.primaryIconOnly} />;
  const interactiveBadge = primaryAction ? (
    <Box
      component="button"
      type="button"
      aria-label={primaryAction.ariaLabel}
      title={primaryAction.ariaLabel}
      disabled={primaryAction.disabled}
      onClick={(event) => {
        event.stopPropagation();
        primaryAction.onClick();
      }}
      sx={{
        display: 'inline-flex',
        p: 0,
        m: 0,
        border: 0,
        borderRadius: '4px',
        bgcolor: 'transparent',
        cursor: primaryAction.disabled ? 'default' : 'pointer',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      {badge}
    </Box>
  ) : badge;

  const content = (
    <Box sx={{ minWidth: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.15 }}>
      <Box sx={{ height: BADGE_HEIGHT, display: 'flex', alignItems: 'center', gap: 0.35, minWidth: 0 }}>
        <Box sx={{ minWidth: 0, flex: presentation.primaryIconOnly ? '0 0 auto' : 1, height: BADGE_HEIGHT, display: 'flex', alignItems: 'center' }}>
          {interactiveBadge}
        </Box>
        {showActionIndicator ? <ActionIndicatorIcon /> : null}
      </Box>
      {presentation.footnote ? (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: 'block', fontSize: 10, lineHeight: 1.2, maxWidth: '100%' }}
        >
          {presentation.footnote}
        </Typography>
      ) : null}
    </Box>
  );

  return hasTooltip && !disableTooltip ? (
    <Tooltip title={<StatusTooltip presentation={presentation} />} arrow placement="top">{content}</Tooltip>
  ) : content;
}

export function rowStatusVisual(status: RegistryStatusDisplay, item?: ApprovalRegisterRow): StatusVisualSpec {
  return rowStatusPresentation(status, item).primary;
}

export function groupStatusVisuals(aggregates: RegisterAggregates, status: RegistryStatusDisplay): StatusVisualSpec[] {
  return [groupStatusPresentation(aggregates, status).primary];
}
