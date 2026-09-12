import { describe, expect, it } from 'vitest';
import type { RequestLog } from '../../types';
import { groupHistoryEntries, historyChanges, historyStatusLabel } from './requestHistory';

const entry = (
  changes: RequestLog['log']['changes'],
  action = 'line_updated',
): RequestLog => ({
  id: 1,
  created_at: '2026-09-01T10:00:00Z',
  user: null,
  subject: null,
  log: { action, entity: 'req_item', changes },
});

const reviewerEntryForLegacy = (
  id: number,
  positionId: string,
  itemId: string,
  eventId: string,
): RequestLog => ({
  ...entry({}, 'position_items_approved_at_step'),
  id,
  created_at: '2026-09-01T10:00:12Z',
  source: 'cfo_position',
  user: { id: 'reviewer', login: 'reviewer', role: 'approver' },
  log: {
    ...entry({}, 'position_items_approved_at_step').log,
    entity: 'cfo_position',
    entity_id: positionId,
    cfo_position_id: positionId,
    step_id: 'step-1',
    item_ids: [itemId],
    event_id: eventId,
  },
});

describe('historyChanges', () => {
  it('uses Russian labels for workflow statuses', () => {
    expect(historyStatusLabel('on_approval')).toBe('На согласовании');
  });

  it('shows the reviewer decision as a business change', () => {
    const [change] = historyChanges(entry({
      reviewer_decision: { from: 'pending', to: 'approved' },
    }));

    expect(change).toEqual({
      field: 'Решение согласующего',
      from: 'Ожидает решения',
      to: 'Согласовано',
    });
  });

  it('projects the decision for historic reviewer events without a changes payload', () => {
    const [change] = historyChanges(entry({}, 'position_items_approved_at_step'));

    expect(change).toEqual({
      field: 'Решение согласующего',
      from: 'Ожидает решения',
      to: 'Согласовано',
    });
  });

  it('groups reviewer line decisions made in one bulk operation', () => {
    const reviewerEntry = (id: number, itemId: string): RequestLog => ({
      ...entry({}, 'position_items_approved_at_step'),
      id,
      created_at: '2026-09-01T10:00:00Z',
      source: 'cfo_position',
      user: { id: 'reviewer', login: 'reviewer', role: 'approver' },
      log: {
        ...entry({}, 'position_items_approved_at_step').log,
        entity: 'req_item',
        entity_id: itemId,
        req_item_id: itemId,
        cfo_position_id: 'position-1',
        step_id: 'step-1',
        item_ids: [itemId],
        event_id: 'bulk-event',
      },
    });

    const groups = groupHistoryEntries([
      reviewerEntry(1, 'item-1'),
      reviewerEntry(2, 'item-2'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].grouped).toBe(true);
    expect(groups[0].entries).toHaveLength(2);
  });

  it('groups legacy reviewer events from one minute-wide bulk operation', () => {
    const first = reviewerEntryForLegacy(3, 'position-1', 'item-3', 'legacy-1');
    const second = reviewerEntryForLegacy(4, 'position-2', 'item-4', 'legacy-2');

    const groups = groupHistoryEntries([first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0].grouped).toBe(true);
  });

  it('renders month plans as a readable list instead of object stringification', () => {
    const [change] = historyChanges(entry({
      month_plans: {
        from: [{ month: 1, sum_plan: 0 }],
        to: [{ month: 1, sum_plan: 1000 }, { month: 2, sum_plan: 250 }],
      },
    }));

    expect(change.field).toBe('Помесячный план');
    expect(change.to).toContain('янв.: 1 000');
    expect(change.to).not.toContain('[object Object]');
  });

  it('never exposes a raw object in a history field', () => {
    expect(historyChanges(entry({ metadata: { from: {}, to: { internal: true } } }))).toEqual([]);
  });

  it('shows only business fields for a newly created request', () => {
    const changes = historyChanges(entry({
      id: { from: null, to: '8c48d77e-718c-4c14-a3e0-0233e181b6c6' },
      unit_id: { from: null, to: '42bd4301-b3f3-4fd1-8491-85534299bac4' },
      budget_year: { from: null, to: 2026 },
      created_at: { from: null, to: '2026-09-01T10:00:00Z' },
      status: { from: null, to: 'draft' },
    }));

    expect(changes).toEqual([{ field: 'Статус', from: '—', to: 'Черновик' }]);
  });
});
