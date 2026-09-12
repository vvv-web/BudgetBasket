import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import type { RequestLog } from '../../types';
import { money } from '../../utils/labels';
import {
  filterLogsByLine,
  groupHistoryEntries,
  historyActionLabel,
  historyActorName,
  historyChanges,
  historyStatusLabel,
  splitRequestLogs,
  type HistoryChange,
} from './requestHistory';

function HistoryChangeList({ changes, heading = false }: { changes: HistoryChange[]; heading?: boolean }) {
  return (
    <Stack className="request-history-changes" spacing={0.75} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: 'grey.50' }}>
      {heading && (
        <Stack className="request-history-changes-heading" direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
          <Typography variant="caption" fontWeight={700}>Изменения</Typography>
          <Typography variant="caption" color="text.secondary">{changes.length} {changes.length === 1 ? 'поле' : 'поля'}</Typography>
        </Stack>
      )}
      {changes.map((change) => (
        <Box key={change.field} className="request-history-change" sx={{ p: 0.75, borderRadius: 1, bgcolor: 'background.paper' }}>
          <Typography className="request-history-change-label" variant="caption" color="text.secondary" fontWeight={700}>{change.field}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="baseline" flexWrap="wrap" useFlexGap>
            <Typography className="request-history-change-old" variant="body2">{change.from}</Typography>
            <Typography variant="caption" color="text.secondary">→</Typography>
            <Typography className="request-history-change-new" variant="body2">{change.to}</Typography>
          </Stack>
        </Box>
      ))}
      {!changes.length && <Typography variant="body2" color="text.secondary">Изменений полей нет.</Typography>}
    </Stack>
  );
}

function historyVisualMeta(entry: RequestLog) {
  const status = entry.log.decision || entry.log.changes?.status?.to;
  if (status === 'on_revision') {
    return { color: 'warning' as const, icon: <EditOutlinedIcon fontSize="small" />, label: 'Выбрано на доработку' };
  }
  if (status === 'approved' || status === 'approved_with_changes' || entry.log.action.includes('approved') || entry.log.action.includes('frozen')) {
    return { color: 'success' as const, icon: <CheckCircleOutlineIcon fontSize="small" />, label: status === 'approved_with_changes' ? 'С изменениями' : 'Согласовано' };
  }
  if (status === 'rejected' || entry.log.action.includes('rejected') || entry.log.action.includes('return')) {
    return { color: 'error' as const, icon: <CancelOutlinedIcon fontSize="small" />, label: status === 'rejected' ? 'Отклонено' : 'На доработку' };
  }
  if (entry.log.action.includes('updated') || entry.log.action.includes('decided')) {
    return { color: 'warning' as const, icon: <EditOutlinedIcon fontSize="small" />, label: 'Изменение' };
  }
  return { color: 'info' as const, icon: <AssignmentTurnedInOutlinedIcon fontSize="small" />, label: 'Событие' };
}

function actionDescription(entry: RequestLog, plural = false) {
  const decision = entry.log.decision || entry.log.changes?.status?.to;
  const role = entry.user?.role;
  const reviewer = role === 'zgd' ? 'ЗГД' : role === 'economist' ? 'Экономист' : role === 'approver' ? 'Согласующий' : role === 'employee' ? 'Ответственный' : 'Участник';
  const suffix = plural ? 'строки' : 'строку';
  if (entry.log.action === 'economist_item_decided') {
    if (decision === 'approved') return `Экономист согласовал ${suffix}`;
    if (decision === 'rejected') return `Экономист отклонил ${suffix}`;
    if (decision === 'approved_with_changes') return `Экономист согласовал ${plural ? 'строки' : 'строку'} с изменениями`;
  }
  if (entry.log.action === 'cfo_item_decided') {
    if (decision === 'approved') return `Ответственный ЦФО согласовал ${suffix}`;
    if (decision === 'rejected') return `Ответственный ЦФО отклонил ${suffix}`;
  }
  if (entry.log.action === 'position_items_approved_at_step') {
    return `Согласующий согласовал ${suffix}`;
  }
  if (entry.log.action === 'position_returned') return `${reviewer} вернул ${plural ? 'строки' : 'позицию'} на доработку`;
  if (entry.log.action === 'position_sent_to_economist') return 'Ответственный ЦФО передал позицию экономисту';
  if (entry.log.action === 'position_frozen_and_forwarded') return 'Экономист зафиксировал строки и передал их дальше';
  if (entry.log.action === 'position_fixed') return 'ЗГД утвердил позицию окончательно';
  return historyActionLabel(entry.log.action);
}

function HistoryEntry({
  entry,
  kindLabel,
}: {
  entry: RequestLog;
  kindLabel: string;
}) {
  const allChanges = historyChanges(entry);
  // Route UUIDs and timestamps are implementation details. For position
  // actions show only the business result (usually the status transition).
  const changes = entry.source === 'cfo_position'
    ? allChanges.filter((change) => ['Статус', 'Утверждённая сумма', 'Фиксация бюджета', 'Решение согласующего'].includes(change.field))
    : allChanges;
  const isLineChange = !!entry.subject;
  const visual = historyVisualMeta(entry);
  const sectionLabel = kindLabel === 'Согласование' ? 'СОГЛАСОВАНИЕ' : kindLabel;
  const content = (
    <Stack direction="row" spacing={1} alignItems="flex-start" className="request-history-entry-content">
      <Box sx={{ width: 30, height: 30, flex: '0 0 auto', mt: 0.05, borderRadius: 1.25, display: 'grid', placeItems: 'center', bgcolor: `${visual.color}.50`, color: `${visual.color}.main` }}>
        {visual.icon}
      </Box>
      <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
      <Typography className="request-history-kind" variant="overline" color="primary.main" fontWeight={700} lineHeight={1.2}>{sectionLabel}</Typography>
      <Typography className="request-history-action" fontWeight={750} lineHeight={1.3}>{actionDescription(entry)}</Typography>
      <Typography className="request-history-meta" variant="caption" color="text.secondary">
        {new Date(entry.created_at).toLocaleString('ru-RU')} · {historyActorName(entry.user)}
      </Typography>
      {entry.request_id && entry.log.action !== 'request_created' && (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Заявка №{entry.request_id.slice(0, 8)}{entry.request_unit_name ? ` · ${entry.request_unit_name}` : ''}
        </Typography>
      )}
      {isLineChange && (
        <>
          <Typography className="request-history-subject" variant="body2" sx={{ pt: 0.3 }}>
            <Box component="span" fontWeight={700}>{entry.subject?.name || 'Наименование не указано'}</Box>
          </Typography>
        </>
      )}
      {entry.log.comment && (
        <Typography variant="body2" sx={{ pt: 0.25, pl: 1, borderLeft: 2, borderColor: 'warning.main' }}>
          <Box component="span" color="text.secondary">Комментарий: </Box>
          {entry.log.comment}
        </Typography>
      )}
      </Stack>
    </Stack>
  );

  if (isLineChange && changes.length > 0) {
    return (
      <Accordion disableGutters elevation={0} sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'background.paper', '&:before': { display: 'none' } }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon fontSize="small" />}
          aria-controls={`request-log-${entry.id}-changes`}
          id={`request-log-${entry.id}-header`}
          sx={{ px: 1.25, py: 1.1, '& .MuiAccordionSummary-content': { my: 0 }, '& .MuiAccordionSummary-content.Mui-expanded': { my: 0 } }}
        >
          {content}
        </AccordionSummary>
        <AccordionDetails id={`request-log-${entry.id}-changes`} sx={{ px: 1.25, pt: 0, pb: 1.25, bgcolor: 'grey.50' }}>
          <HistoryChangeList changes={changes} heading />
        </AccordionDetails>
      </Accordion>
    );
  }

  return (
    <Box sx={{ mb: 1, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
      {content}
      {!isLineChange && changes.length > 0 && <HistoryChangeList changes={changes} />}
    </Box>
  );
}

function GroupHistoryEntry({ entries }: { entries: RequestLog[] }) {
  const first = entries[0];
  const isReviewerDecisionGroup = entries.every((entry) => entry.log.action === 'position_items_approved_at_step');
  const isPositionGroup = isReviewerDecisionGroup || entries.every((entry) => entry.log.entity === 'cfo_position' && entry.log.action !== 'economist_item_decided');
  const positions = new Set(entries.map((entry) => entry.log.cfo_position_id || entry.log.entity_id));
  const itemIds = new Set(entries.flatMap((entry) => entry.log.item_ids || [entry.log.req_item_id]).filter(Boolean));
  const requestIds = new Set(entries.flatMap((entry) => entry.log.request_ids || [entry.request_id]).filter(Boolean));
  const positionsWithLines = new Map<string, RequestLog[]>();
  entries.forEach((entry) => {
    const positionId = entry.log.cfo_position_id || entry.log.entity_id || entry.id.toString();
    positionsWithLines.set(positionId, [...(positionsWithLines.get(positionId) || []), entry]);
  });

  const decisionFor = (entry: RequestLog) => {
    if (entry.log.action === 'position_items_approved_at_step') return 'approved';
    const status = entry.log.decision || entry.log.changes?.status?.to;
    return typeof status === 'string'
      ? historyStatusLabel(status)
      : undefined;
  };

  const decisionsSummary = Object.entries(entries.reduce<Record<string, number>>((counts, entry) => {
    const decision = decisionFor(entry);
    if (decision) counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, {})).map(([decision, count]) => `${decision}: ${count}`).join(' · ');
  const decisionKinds = new Set(entries.map((entry) => entry.log.decision || entry.log.changes?.status?.to).filter(Boolean));
  const hasMixedDecisions = decisionKinds.size > 1;

  const decisionMeta = (entry: RequestLog) => {
    const decision = entry.log.decision || entry.log.changes?.status?.to;
    if (decision === 'approved') return { label: 'Утверждено', color: 'success' as const, icon: <CheckCircleOutlineIcon fontSize="small" /> };
    if (decision === 'rejected') return { label: 'Отклонено', color: 'error' as const, icon: <CancelOutlinedIcon fontSize="small" /> };
    if (decision === 'approved_with_changes') return { label: 'С изменениями', color: 'warning' as const, icon: <EditOutlinedIcon fontSize="small" /> };
    return { label: 'Решение', color: 'default' as const, icon: <AssignmentTurnedInOutlinedIcon fontSize="small" /> };
  };

  const firstDecision = decisionMeta(first);
  const positionStatus = first.log.changes?.status?.to;
  const groupSummary = isPositionGroup
    ? `${positions.size} ${positions.size === 1 ? 'позиция' : 'позиции'} · ${requestIds.size || positions.size} ${requestIds.size === 1 ? 'заявка' : 'заявки'}`
    : `${positions.size} группировки · ${itemIds.size || 0} строк`;
  const positionStatusLabel = typeof positionStatus === 'string'
    ? historyStatusLabel(positionStatus)
    : '';
  const groupStatusLabel = positionStatusLabel || (isReviewerDecisionGroup ? 'Согласовано' : '');
  const groupChanges = isReviewerDecisionGroup ? historyChanges(first) : [];

  const resultFor = (entry: RequestLog) => {
    const decision = decisionFor(entry);
    const sumFact = entry.log.agreed_sum ?? entry.log.changes?.sum_fact?.to;
    return [
      decision && `Решение: ${decision}`,
      sumFact !== undefined && `Согласовано: ${money(Number(sumFact))}`,
    ].filter(Boolean).join(' · ') || actionDescription(entry);
  };

  return (
    <Accordion disableGutters elevation={0} sx={{ mb: 1.25, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper', '&:before': { display: 'none' } }}>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        aria-controls={`request-log-group-${first.log.event_id}-details`}
        id={`request-log-group-${first.log.event_id}-header`}
        sx={{ px: 1.5, py: 1.5, '& .MuiAccordionSummary-content': { my: 0 }, '& .MuiAccordionSummary-content.Mui-expanded': { my: 0 } }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ width: '100%' }}>
          <Box sx={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: firstDecision.color === 'success' ? 'success.50' : firstDecision.color === 'error' ? 'error.50' : 'warning.50', color: `${firstDecision.color}.main` }}>
            {firstDecision.icon}
          </Box>
          <Stack className="request-history-entry-content" spacing={0.55} sx={{ minWidth: 0, flex: 1 }}>
            <Typography className="request-history-kind" variant="overline" color="primary.main" fontWeight={700} lineHeight={1.2}>Групповое действие</Typography>
            <Typography className="request-history-action" fontWeight={800} lineHeight={1.3}>{actionDescription(first, true)}</Typography>
          <Typography className="request-history-meta" variant="caption" color="text.secondary">
            {new Date(first.created_at).toLocaleString('ru-RU')} · {historyActorName(first.user)}
          </Typography>
          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ pt: 0.25 }}>
            <Chip size="small" variant="outlined" label={groupSummary} />
            {isPositionGroup
              ? groupStatusLabel && <Chip size="small" color={firstDecision.color} icon={firstDecision.icon} label={groupStatusLabel} />
              : decisionsSummary && <Chip size="small" color={firstDecision.color} icon={firstDecision.icon} label={decisionsSummary} />}
          </Stack>
          {first.log.comment && (
            <Typography variant="body2" sx={{ pt: 0.25 }}>
              <Box component="span" color="text.secondary">Комментарий: </Box>
              {first.log.comment}
            </Typography>
          )}
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails id={`request-log-group-${first.log.event_id}-details`} sx={{ px: 0, pt: 0, pb: 1.5 }}>
        <Stack spacing={1.25} sx={{ px: 1.5, py: 1.25, bgcolor: 'grey.50' }}>
          {groupChanges.length > 0 && <HistoryChangeList changes={groupChanges} heading />}
          <Typography variant="caption" color="text.secondary" fontWeight={800} sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Состав операции</Typography>
          {[...positionsWithLines.values()].map((positionEntries) => {
            const positionFirst = positionEntries[0];
            const contextItems = positionEntries.flatMap((entry) => entry.log.item_contexts || []);
            const contextsByRequest = new Map<string, typeof contextItems>();
            contextItems.forEach((item) => contextsByRequest.set(item.request_id, [...(contextsByRequest.get(item.request_id) || []), item]));
            if (isPositionGroup && contextItems.length > 0) {
              return (
                <Stack key={positionFirst.log.cfo_position_id || positionFirst.id} spacing={1}>
                  {[...contextsByRequest.entries()].map(([requestId, requestItems]) => (
                    <Stack key={requestId} spacing={0.7} sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography variant="body2" fontWeight={800}>Заявка №{requestId.slice(0, 8)}{requestItems[0]?.request_unit_name ? ` · ${requestItems[0].request_unit_name}` : ''}</Typography>
                        <Chip size="small" label={`${requestItems.length} ${requestItems.length === 1 ? 'строка' : 'строк'}`} />
                      </Stack>
                      <Box sx={{ height: 1, bgcolor: 'divider' }} />
                      {requestItems.map((item) => (
                        <Stack key={item.id} direction="row" spacing={0.75} alignItems="center" sx={{ py: 0.25 }}>
                          <Box sx={{ color: `${decisionMeta(positionFirst).color}.main`, display: 'flex' }}>{decisionMeta(positionFirst).icon}</Box>
                          <Typography variant="body2">{item.name || 'Строка заявки'}</Typography>
                        </Stack>
                      ))}
                    </Stack>
                  ))}
                </Stack>
              );
            }
            return (
              <Stack key={positionFirst.log.cfo_position_id || positionFirst.id} spacing={0.75} sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="body2" fontWeight={800}>
                  {positionFirst.request_id ? `Заявка №${positionFirst.request_id.slice(0, 8)}` : 'Группировка'}
                  {positionFirst.request_unit_name ? ` · ${positionFirst.request_unit_name}` : ''}
                </Typography>
                <Chip size="small" label={`${positionEntries.length} ${positionEntries.length === 1 ? 'строка' : 'строк'}`} />
                </Stack>
                <Box sx={{ height: 1, bgcolor: 'divider' }} />
                {positionEntries.map((entry) => (
                  <Stack key={entry.id} direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.35 }}>
                    <Box sx={{ pt: 0.15, color: `${decisionMeta(entry).color}.main`, display: 'flex' }}>{decisionMeta(entry).icon}</Box>
                    <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {isPositionGroup
                        ? (entry.request_id ? `Заявка №${entry.request_id.slice(0, 8)}` : 'Позиция ЦФО')
                        : (entry.subject?.name || 'Строка заявки')}
                    </Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
                      {isPositionGroup
                        ? <Chip size="small" color={decisionMeta(entry).color} variant="outlined" label={actionDescription(entry)} />
                        : <>
                          {hasMixedDecisions && <Chip size="small" color={decisionMeta(entry).color} variant="outlined" label={resultFor(entry).split(' · ')[0]} />}
                          {entry.log.agreed_sum !== undefined && <Chip size="small" variant="outlined" label={`Согласовано ${money(Number(entry.log.agreed_sum))}`} />}
                        </>}
                    </Stack>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function RequestHistoryPanel({
  logs,
  loading = false,
  lineId,
  lineName,
  defaultTab = 'content',
  showTabs = true,
  embedded = false,
}: {
  logs: RequestLog[];
  loading?: boolean;
  lineId?: string;
  lineName?: string;
  defaultTab?: 'content' | 'approval';
  showTabs?: boolean;
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<'content' | 'approval'>(defaultTab);
  const filteredLogs = useMemo(() => filterLogsByLine(logs, lineId, lineName), [lineId, lineName, logs]);
  const { content, approval } = useMemo(() => splitRequestLogs(filteredLogs), [filteredLogs]);
  const contentGroups = useMemo(() => groupHistoryEntries(content), [content]);
  const approvalGroups = useMemo(() => groupHistoryEntries(approval), [approval]);

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: embedded ? 2 : 4 }}>
        <CircularProgress size={28} />
      </Stack>
    );
  }

  return (
    <Stack spacing={0} sx={{ minHeight: embedded ? 0 : undefined }}>
      {showTabs && (
        <Tabs
          value={tab}
          onChange={(_, value: 'content' | 'approval') => setTab(value)}
          variant="fullWidth"
          sx={{ px: embedded ? 0 : 1.5, borderBottom: 1, borderColor: 'divider', mb: 0.5 }}
        >
          <Tab value="content" label="Содержимое" />
          <Tab value="approval" label="Согласование" />
        </Tabs>
      )}
      <Stack sx={{ px: embedded ? 0 : 2.5, overflowY: embedded ? 'visible' : 'auto', maxHeight: embedded ? 420 : undefined }}>
        {(showTabs ? tab === 'content' : true) && contentGroups.map((group) => (
          group.grouped
            ? <GroupHistoryEntry key={group.id} entries={group.entries} />
            : <HistoryEntry key={group.id} entry={group.entries[0]} kindLabel={group.entries[0].subject ? 'Строка заявки' : 'Заявка'} />
        ))}
        {(showTabs ? tab === 'content' : false) && !content.length && (
          <Typography sx={{ py: 2 }} color="text.secondary">Изменений содержимого пока нет.</Typography>
        )}
        {(showTabs ? tab === 'approval' : false) && approvalGroups.map((group) => (
          group.grouped
            ? <GroupHistoryEntry key={group.id} entries={group.entries} />
            : <HistoryEntry key={group.id} entry={group.entries[0]} kindLabel="Согласование" />
        ))}
        {(showTabs ? tab === 'approval' : false) && !approval.length && (
          <Typography sx={{ py: 2 }} color="text.secondary">Событий согласования пока нет.</Typography>
        )}
      </Stack>
    </Stack>
  );
}
