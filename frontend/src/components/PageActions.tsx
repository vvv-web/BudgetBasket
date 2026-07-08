import Stack from '@mui/material/Stack';
import type { ReactNode } from 'react';

/** Inline action buttons for page content (not chrome). */
export function PageActions({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap className="page-actions" justifyContent="flex-end">
      {children}
    </Stack>
  );
}
