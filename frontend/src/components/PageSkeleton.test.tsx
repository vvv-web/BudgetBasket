import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageSkeleton, TableRowsSkeleton } from './PageSkeleton';

afterEach(cleanup);

describe('PageSkeleton', () => {
  it.each(['table', 'dashboard', 'details'] as const)('announces the %s page loading state', (variant) => {
    render(<PageSkeleton variant={variant} label={`Загрузка: ${variant}`} />);

    const status = screen.getByRole('status', { name: `Загрузка: ${variant}` });
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the requested number of placeholder table rows', () => {
    const { container } = render(
      <Table><TableBody><TableRowsSkeleton rows={4} columns={3} /></TableBody></Table>,
    );

    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(container.querySelectorAll('tbody td')).toHaveLength(12);
  });
});
