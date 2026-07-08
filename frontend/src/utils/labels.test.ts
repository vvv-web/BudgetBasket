import { describe, expect, it } from 'vitest';
import { itemStatusLabels, requestStatusLabels } from './labels';

describe('labels', () => {
  it('shows Russian request statuses', () => {
    expect(requestStatusLabels.approved).toBe('Утверждена');
    expect(requestStatusLabels.on_review).toBe('На проверке');
  });

  it('shows Russian item statuses', () => {
    expect(itemStatusLabels.approved_with_changes).toBe('Утверждено с изменениями');
    expect(itemStatusLabels.on_review).toBe('На рассмотрении');
  });
});
