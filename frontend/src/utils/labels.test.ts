import { describe, expect, it } from 'vitest';
import { itemStatusLabels, requestStatusLabels } from './labels';

describe('labels', () => {
  it('shows Russian request statuses', () => {
    expect(requestStatusLabels.fixed).toBe('Бюджет зафиксирован');
  });

  it('shows Russian item statuses', () => {
    expect(itemStatusLabels.accepted_adjusted).toBe('Принято с корректировкой суммы');
  });
});
