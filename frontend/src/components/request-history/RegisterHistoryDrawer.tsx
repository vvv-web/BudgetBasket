import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { usePagedCursor } from '../../api/usePagedCursor';
import type { RequestLog } from '../../types';
import { RequestHistoryPanel } from './RequestHistoryPanel';

export function RegisterHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items: logs, isPending, hasNextPage, fetchNextPage, isFetchingNextPage, isError } = usePagedCursor<RequestLog>(
    ['approval-register-history'], '/approval-register/history', open,
  );

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ className: 'request-history-drawer' }}>
      <Stack className="request-chat-header" direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box minWidth={0}>
          <Typography variant="h6" noWrap>Общая история</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>Изменения и согласование доступных вам заявок</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Закрыть историю"><CloseIcon /></IconButton>
      </Stack>
      <RequestHistoryPanel logs={logs} loading={isPending} />
      {hasNextPage && (
        <Button sx={{ m: 2, mt: 0 }} disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {isError ? 'Повторить загрузку истории' : 'Показать более ранние события'}
        </Button>
      )}
    </Drawer>
  );
}
