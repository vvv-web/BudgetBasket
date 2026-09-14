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

export type RequestHistoryTarget = {
  requestId: string;
  lineId?: string;
  lineName?: string;
  title?: string;
  subtitle?: string;
};

export function RequestHistoryDrawer({
  target,
  onClose,
  defaultTab = 'content',
}: {
  target: RequestHistoryTarget | null;
  onClose: () => void;
  defaultTab?: 'content' | 'approval';
}) {
  const requestId = target?.requestId;
  const { items: logs, isPending, hasNextPage, fetchNextPage, isFetchingNextPage, isError } = usePagedCursor<RequestLog>(
    ['request-logs', requestId], `/requests/${requestId}/logs`, !!requestId,
  );

  return (
    <Drawer anchor="right" open={!!target} onClose={onClose} PaperProps={{ className: 'request-history-drawer' }}>
      <Stack className="request-chat-header" direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box minWidth={0}>
          <Typography variant="h6" noWrap>{target?.title || 'История изменений'}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {target?.subtitle || (requestId ? `Заявка №${requestId.slice(0, 8)}` : 'Все события по заявке')}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Закрыть историю изменений"><CloseIcon /></IconButton>
      </Stack>
      <RequestHistoryPanel
        key={`${requestId}:${defaultTab}`}
        logs={logs}
        loading={isPending}
        lineId={target?.lineId}
        lineName={target?.lineName}
        defaultTab={defaultTab}
      />
      {hasNextPage && (
        <Button sx={{ m: 2, mt: 0 }} disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {isError ? 'Повторить загрузку истории' : 'Показать более ранние события'}
        </Button>
      )}
    </Drawer>
  );
}
