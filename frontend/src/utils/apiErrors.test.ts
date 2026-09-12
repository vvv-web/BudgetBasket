import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { getApiErrorDetail, getApiErrorMessage, getDownloadApiErrorMessage } from './apiErrors';

describe('getApiErrorMessage', () => {
  it('returns API detail string', () => {
    const error = new axios.AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 409,
        data: { detail: 'Заявка не находится на проверке ЦФО' },
        statusText: 'Conflict',
        headers: {},
        config: {} as never,
      },
    );
    expect(getApiErrorMessage(error, 'fallback')).toBe('Заявка не находится на проверке ЦФО');
  });

  it('returns thrown Error message', () => {
    expect(getApiErrorMessage(new Error('Для этой строки действие больше недоступно'), 'fallback'))
      .toBe('Для этой строки действие больше недоступно');
  });

  it('returns a message and exposes metadata from structured API detail', () => {
    const detail = {
      message: 'Для модуля уже существует заявка текущего года',
      request_id: 'request-123',
    };
    const error = new axios.AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 409,
        data: { detail },
        statusText: 'Conflict',
        headers: {},
        config: {} as never,
      },
    );

    expect(getApiErrorMessage(error, 'fallback')).toBe(detail.message);
    expect(getApiErrorDetail(error)).toEqual(detail);
  });

  it('falls back when detail is missing', () => {
    expect(getApiErrorMessage(new Error('unknown'), 'Не удалось сохранить')).toBe('unknown');
    expect(getApiErrorMessage(null, 'Не удалось сохранить')).toBe('Не удалось сохранить');
  });

  it('reads an API error from a download blob', async () => {
    const error = new axios.AxiosError(
      'Request failed with status code 400',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 400,
        data: { text: async () => JSON.stringify({ detail: 'Нет строк выбранного типа для экспорта' }) },
        statusText: 'Bad request',
        headers: {},
        config: {} as never,
      },
    );
    await expect(getDownloadApiErrorMessage(error, 'fallback')).resolves.toBe('Нет строк выбранного типа для экспорта');
  });
});
