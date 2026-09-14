import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../types';
import { UserGuideDialog, userGuideContent } from './UserGuideDialog';

afterEach(cleanup);

const roles: Role[] = ['employee', 'economist', 'approver', 'zgd', 'admin'];

describe('UserGuideDialog', () => {
  it('contains one shared guide and instructions for all five application roles', () => {
    expect(userGuideContent.common.length).toBeGreaterThanOrEqual(10);
    expect(userGuideContent.journey).toHaveLength(5);
    expect(Object.keys(userGuideContent.roles).sort()).toEqual([...roles, 'cfo'].sort());
    expect(userGuideContent.usage).toContain('общую часть');
    expect(userGuideContent.usage).toContain('поиск по памятке');
    expect(userGuideContent.usage).not.toContain('Ответственный за модуль');
    expect(userGuideContent.usage).not.toContain('Ответственный за ЦФО');

    roles.forEach((role) => {
      expect(userGuideContent.roles[role].intro.length).toBeGreaterThan(40);
      expect(userGuideContent.roles[role].quickStart).toHaveLength(5);
      expect(userGuideContent.roles[role].sections.length).toBeGreaterThan(0);
    });
  });

  it.each(roles)('opens with common and role-specific content for %s', (role) => {
    render(<UserGuideDialog role={role} open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(userGuideContent.title)).toBeTruthy();
    expect(screen.getAllByText('1. Что такое BudgetBasket и как проходит бюджет').length).toBeGreaterThan(0);
    expect(screen.getAllByText(userGuideContent.roles[role].sections[0].title).length).toBeGreaterThan(0);
    expect(screen.getByText('Порядок работы')).toBeTruthy();
  });

  it('keeps CFO responsibility as an explicit employee assignment', () => {
    render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);
    expect(screen.getByText('Работа в роли: Ответственный за модуль')).toBeTruthy();
    expect(screen.queryByText('11. Доступ ответственного за ЦФО')).toBeNull();
    fireEvent.change(screen.getByLabelText('Поиск по руководству'), { target: { value: 'помесячный план' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Моя зона ответственности' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ответственный за ЦФО' }));
    expect(screen.getByText('Работа в роли: Ответственный за ЦФО')).toBeTruthy();
    expect(screen.getByText('11. Доступ ответственного за ЦФО')).toBeTruthy();
    expect(screen.queryByText('12. Создание заявки')).toBeNull();
    expect((screen.getByLabelText('Поиск по руководству') as HTMLInputElement).value).toBe('');
    expect(userGuideContent.roles.cfo.intro).toContain('В приложении ваша роль — «Сотрудник»');
  });

  it('uses the document wording for the budget flow', () => {
    expect(userGuideContent.journey.map((stage) => stage.detail)).toEqual([
      'Ответственный за модуль заполняет и отправляет заявку',
      'Ответственный за ЦФО проверяет строки и передаёт бюджет экономисту',
      'Экономист проверяет суммы и передаёт бюджет на согласование',
      'Проверяющий рассматривает бюджет или возвращает замечания',
      'ЗГД согласует строки и отдельно фиксирует бюджет, блокируя его изменение',
    ]);
  });

  it('opens CFO instructions when the employee is assigned to a CFO', () => {
    render(<UserGuideDialog role="employee" defaultEmployeeAssignment="cfo" open onClose={vi.fn()} />);
    expect(screen.getByText('Работа в роли: Ответственный за ЦФО')).toBeTruthy();
    expect(screen.queryByText('12. Создание заявки')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Моя зона ответственности' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ответственный за модуль' }));
    expect(screen.getByText('Работа в роли: Ответственный за модуль')).toBeTruthy();
    expect(screen.queryByText('11. Доступ ответственного за ЦФО')).toBeNull();
  });

  it('expands a collapsed instruction section', () => {
    render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);
    const summary = screen
      .getAllByText('2. Вход, навигация и профиль')
      .map((element) => element.closest('.MuiAccordionSummary-root'))
      .find(Boolean);

    expect(summary?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary!);
    expect(summary?.getAttribute('aria-expanded')).toBe('true');
  });

  it('scrolls an expanded section to the top of the guide window', async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });

    try {
      render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);
      const summary = screen.getByRole('button', { name: userGuideContent.common[1].title });
      fireEvent.click(summary);

      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: originalScrollTo });
    }
  });

  it('filters and expands matching sections', () => {
    render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Поиск по руководству'), { target: { value: 'помесячный план' } });

    expect(screen.getByText(/Найдено разделов: [1-9]/)).toBeTruthy();
    const matchingSummary = screen
      .getAllByText('14. Помесячный план')
      .map((element) => element.closest('.MuiAccordionSummary-root'))
      .find(Boolean);
    expect(matchingSummary?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a clear empty state for an unsuccessful search', () => {
    render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Поиск по руководству'), { target: { value: 'несуществующийраздел' } });

    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.getByText('Найдено разделов: 0. Совпавшие разделы раскрыты полностью.')).toBeTruthy();
  });

  it('uses a full-screen dialog on a mobile viewport', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: '(max-width:599.95px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<UserGuideDialog role="employee" open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog').className).toContain('MuiDialog-paperFullScreen');

    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
  });
});
