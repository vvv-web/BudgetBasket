import {
  Alert,
  AlertTitle,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import { api } from '../api/client';
import type { BudgetItem, BudgetRequest, ItemStatus } from '../types';

type CfoReviewRequest = Pick<BudgetRequest, 'id' | 'budget_year'>;

const itemStatus: Record<string, string> = {
  on_review: 'Без решения',
  approved: 'Одобрено',
  approved_with_changes: 'Одобрено с изменениями',
  rejected: 'Отклонено',
  deleted: 'Удалено',
};

const money = (value: number | null | undefined) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value || 0);

function errorText(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}

function DecisionDialog({
  open,
  title,
  allowChanges,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  allowChanges: boolean;
  onClose: () => void;
  onSubmit: (decision: ItemStatus, comment: string, sumFact?: number) => void;
}) {
  const [decision, setDecision] = useState<ItemStatus>('approved');
  const [comment, setComment] = useState('');
  const [sumFact, setSumFact] = useState('');
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>{title}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <FormControl fullWidth><InputLabel>Решение</InputLabel><Select value={decision} label="Решение" onChange={(event) => setDecision(event.target.value as ItemStatus)}>
        <MenuItem value="approved">Одобрить</MenuItem>
        {allowChanges && <MenuItem value="approved_with_changes">Одобрить с изменениями</MenuItem>}
        <MenuItem value="rejected">Отклонить</MenuItem>
      </Select></FormControl>
      {decision === 'approved_with_changes' && <TextField label="Новая согласованная сумма" type="number" value={sumFact} onChange={(event) => setSumFact(event.target.value)} />}
      <TextField label={decision === 'approved' ? 'Комментарий (необязательно)' : 'Комментарий'} multiline minRows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Отмена</Button><Button variant="contained" disabled={(decision !== 'approved' && !comment.trim()) || (decision === 'approved_with_changes' && !sumFact)} onClick={() => onSubmit(decision, comment.trim(), sumFact ? Number(sumFact) : undefined)}>Сохранить решение</Button></DialogActions>
  </Dialog>;
}

export function CfoRequestReviewDialog({
  request,
  open,
  onClose,
}: {
  request: CfoReviewRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['cfo-request-items', request?.id],
    queryFn: async () => (await api.get<BudgetItem[]>(`/requests/${request!.id}/items`, { params: { include_deleted: false } })).data,
    enabled: open && !!request,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cfo-request-items', request?.id] });
    queryClient.invalidateQueries({ queryKey: ['cfo-incoming-requests'] });
    queryClient.invalidateQueries({ queryKey: ['cfo-positions'] });
    queryClient.invalidateQueries({ queryKey: ['cfo-approval-route'] });
    queryClient.invalidateQueries({ queryKey: ['approval-register'] });
    queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
  };
  const decide = useMutation({
    mutationFn: async ({ decision, comment, sumFact }: { decision: ItemStatus; comment: string; sumFact?: number }) => (
      targetIds.length === 1
        ? api.post(`/items/${targetIds[0]}/cfo-decision`, { decision, comment, ...(sumFact !== undefined ? { sum_fact: sumFact } : {}) })
        : api.post('/items/cfo-decision/bulk', { item_ids: targetIds, decision, comment })
    ),
    onSuccess: () => { setDecisionOpen(false); setTargetIds([]); invalidate(); },
  });
  const complete = useMutation({
    mutationFn: () => api.post(`/requests/${request!.id}/complete-cfo-review`),
    onSuccess: () => { invalidate(); onClose(); },
  });
  const active = items.filter((item) => item.status !== 'deleted');
  const pending = active.filter((item) => item.status === 'on_review').length;
  return <>
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Проверка заявки {request?.id.slice(0, 8)} · {request?.budget_year}</DialogTitle>
      <DialogContent>
        {(decide.error || complete.error) && <Alert severity="error" sx={{ mb: 2 }}>{errorText(decide.error || complete.error)}</Alert>}
        {!isLoading && (
          <Alert severity={pending > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
            <AlertTitle>{pending > 0 ? 'Требуется ваше решение' : 'Все строки рассмотрены'}</AlertTitle>
            {pending > 0
              ? `Примите решение по ${pending} ${pending === 1 ? 'строке' : 'строкам'}. После этого завершите проверку заявки.`
              : 'Нажмите «Завершить проверку», чтобы передать согласованные строки в маршрут и закрыть проверку заявки.'}
          </Alert>
        )}
        {isLoading ? <CircularProgress /> : <TableContainer component={Paper} variant="outlined"><Table size="small"><TableHead><TableRow><TableCell padding="checkbox" /><TableCell>Строка</TableCell><TableCell align="right">План</TableCell><TableCell align="right">Решение</TableCell><TableCell>Статус</TableCell><TableCell>Комментарий</TableCell></TableRow></TableHead><TableBody>
          {active.map((item) => <TableRow key={item.id}><TableCell padding="checkbox"><Checkbox checked={targetIds.includes(item.id)} onChange={(_, checked) => setTargetIds((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></TableCell><TableCell>{item.name}</TableCell><TableCell align="right">{money(item.sum_plan)}</TableCell><TableCell align="right">{money(item.sum_fact)}</TableCell><TableCell>{itemStatus[item.status]}</TableCell><TableCell>{item.comment || '—'}</TableCell></TableRow>)}
        </TableBody></Table></TableContainer>}
      </DialogContent>
      <DialogActions><Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>Без решения: {pending}</Typography><Button onClick={onClose}>Закрыть</Button><Button disabled={!targetIds.length} onClick={() => setDecisionOpen(true)}>Решение по выбранным</Button><Button variant="contained" disabled={!active.length || pending > 0 || complete.isPending} onClick={() => complete.mutate()}>Завершить проверку</Button></DialogActions>
    </Dialog>
    <DecisionDialog open={decisionOpen} title={`Решение по строкам: ${targetIds.length}`} allowChanges={targetIds.length === 1} onClose={() => setDecisionOpen(false)} onSubmit={(decision, comment, sumFact) => decide.mutate({ decision, comment, sumFact })} />
  </>;
}
