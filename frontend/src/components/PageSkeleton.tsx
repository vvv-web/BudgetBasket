import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';

type PageSkeletonVariant = 'table' | 'dashboard' | 'details';

export function TableRowsSkeleton({ rows = 8, columns = 7 }: { rows?: number; columns?: number }) {
  return Array.from({ length: rows }, (_, rowIndex) => (
    <TableRow key={rowIndex} aria-hidden="true">
      {Array.from({ length: columns }, (_, columnIndex) => (
        <TableCell key={columnIndex} sx={{ py: 1.15 }}>
          <Skeleton
            variant="text"
            width={columnIndex === 0 ? '72%' : columnIndex % 3 === 0 ? '88%' : '60%'}
            height={20}
          />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function HeaderSkeleton() {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
      <Skeleton variant="text" width={220} height={38} />
      <Stack direction="row" spacing={1}>
        <Skeleton variant="rounded" width={112} height={34} />
        <Skeleton variant="rounded" width={96} height={34} />
      </Stack>
    </Stack>
  );
}

export function PageSkeleton({
  variant = 'table',
  label = 'Загрузка страницы',
}: {
  variant?: PageSkeletonVariant;
  label?: string;
}) {
  if (variant === 'dashboard') {
    return (
      <Stack spacing={2.5} role="status" aria-busy="true" aria-label={label}>
        <HeaderSkeleton />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2 }}>
          {Array.from({ length: 4 }, (_, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 2.25, borderRadius: 3 }} aria-hidden="true">
              <Skeleton width="48%" height={20} />
              <Skeleton width="72%" height={42} sx={{ mt: 0.5 }} />
              <Skeleton width="60%" height={18} />
            </Paper>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.5fr) minmax(300px, 1fr)' }, gap: 2 }}>
          <Skeleton variant="rounded" height={320} sx={{ borderRadius: 3 }} />
          <Skeleton variant="rounded" height={320} sx={{ borderRadius: 3 }} />
        </Box>
      </Stack>
    );
  }

  if (variant === 'details') {
    return (
      <Stack spacing={2.5} role="status" aria-busy="true" aria-label={label}>
        <HeaderSkeleton />
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Skeleton width="34%" height={30} />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={96} sx={{ flex: 1, borderRadius: 2 }} />
            <Skeleton variant="rounded" height={96} sx={{ flex: 1, borderRadius: 2 }} />
            <Skeleton variant="rounded" height={96} sx={{ flex: 1, borderRadius: 2 }} />
          </Stack>
        </Paper>
        <Skeleton variant="rounded" height={132} sx={{ borderRadius: 3 }} />
        <Skeleton variant="rounded" height={300} sx={{ borderRadius: 3 }} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} role="status" aria-busy="true" aria-label={label}>
      <HeaderSkeleton />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} aria-hidden="true">
          <Skeleton variant="rounded" height={40} sx={{ flex: 1 }} />
          <Skeleton variant="rounded" width={180} height={40} />
          <Skeleton variant="rounded" width={150} height={40} />
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }} aria-hidden="true">
        <Skeleton variant="rounded" height={36} sx={{ mb: 1.5 }} />
        {Array.from({ length: 8 }, (_, index) => (
          <Stack key={index} direction="row" spacing={2} sx={{ py: 0.85 }}>
            <Skeleton variant="text" width="28%" height={22} />
            <Skeleton variant="text" width="18%" height={22} />
            <Skeleton variant="text" width="22%" height={22} />
            <Skeleton variant="text" sx={{ flex: 1 }} height={22} />
          </Stack>
        ))}
      </Paper>
    </Stack>
  );
}
