import { describe, expect, it } from 'vitest';
import { chatDayKey, chatDayLabel } from './chat';

describe('chat day labels', () => {
  const now = new Date(2026, 6, 21, 12, 0);

  it('uses Telegram-style labels for today and yesterday', () => {
    expect(chatDayLabel(new Date(2026, 6, 21, 8, 30).toISOString(), now)).toBe('Сегодня');
    expect(chatDayLabel(new Date(2026, 6, 20, 20, 0).toISOString(), now)).toBe('Вчера');
  });

  it('groups messages by their local calendar day', () => {
    expect(chatDayKey(new Date(2026, 6, 21, 8, 30).toISOString())).toBe(chatDayKey(new Date(2026, 6, 21, 20, 0).toISOString()));
    expect(chatDayKey(new Date(2026, 6, 20, 20, 0).toISOString())).not.toBe(chatDayKey(new Date(2026, 6, 21, 8, 30).toISOString()));
  });
});
