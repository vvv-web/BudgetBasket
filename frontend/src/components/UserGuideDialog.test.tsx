import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../types';
import { UserGuideDialog, userGuideContent } from './UserGuideDialog';

afterEach(cleanup);

const roles: Role[] = ['employee', 'economist', 'approver', 'zgd', 'admin'];

describe('UserGuideDialog', () => {
  it('contains one shared guide and instructions for all five application roles', () => {
    expect(userGuideContent.common.length).toBeGreaterThanOrEqual(10);
    expect(userGuideContent.journey).toHaveLength(5);
    expect(Object.keys(userGuideContent.roles).sort()).toEqual([...roles].sort());

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
    const employeeText = JSON.stringify(userGuideContent.roles.employee);
    expect(employeeText).toContain('Если вы ответственны за ЦФО');
    expect(employeeText).toContain('Это не отдельная базовая роль');
  });

  it('uses the document wording for the budget flow', () => {
    expect(userGuideContent.journey.map((stage) => stage.detail)).toEqual([
      'Сотрудник формирует потребность модуля в заявку',
      'Ответственный ЦФО проверяет заявки модулей',
      'Проверяет суммы, определяет сумму для утверждения и замораживает бюджет',
      'Позиции проходят настроенный граф этапов согласования',
      'Финальный этап согласования, после него заявки недоступны для редактирования',
    ]);
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
