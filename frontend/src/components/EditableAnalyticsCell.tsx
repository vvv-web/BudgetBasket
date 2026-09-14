import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useAppToast } from './Layout';
import { InlineEditTextCell } from './inlineEdit';
import { ConfirmDialog } from './ConfirmDialog';
import { ANALYTICS_FIELD_LABELS, type AnalyticsFieldKey } from '../utils/analyticsFields';
import { getApiErrorMessage } from '../utils/apiErrors';

export function EditableAnalyticsCell({
  itemId,
  field,
  value,
  editable,
  multiline = false,
  onSaved,
  confirmBeforeSave = false,
}: {
  itemId: string;
  field: AnalyticsFieldKey;
  value: string;
  editable: boolean;
  multiline?: boolean;
  onSaved?: () => void;
  confirmBeforeSave?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (next: string) => api.patch(`/items/${itemId}`, { [field]: next }),
    onSuccess: () => {
      setPendingValue(null);
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ['approval-register'] });
      queryClient.invalidateQueries({ queryKey: ['approval-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['request-details'] });
    },
    onError: (error) => {
      setPendingValue(null);
      toast(getApiErrorMessage(error, 'Не удалось сохранить аналитику'), 'error');
    },
  });

  const commit = (next: string) => {
    if (confirmBeforeSave) {
      setPendingValue(next);
      return;
    }
    save.mutate(next);
  };

  return (
    <>
      <InlineEditTextCell
        value={value}
        editable={editable}
        multiline={multiline}
        pending={save.isPending}
        ariaLabel={ANALYTICS_FIELD_LABELS[field]}
        tooltip={`Нажмите, чтобы изменить ${ANALYTICS_FIELD_LABELS[field].toLowerCase()}`}
        onCommit={commit}
      />
      <ConfirmDialog
        open={pendingValue !== null}
        title="Подтвердить изменение"
        description={`Изменить «${ANALYTICS_FIELD_LABELS[field]}» с «${value || '—'}» на «${pendingValue || '—'}»?`}
        confirmLabel="Подтвердить"
        confirmColor="primary"
        pending={save.isPending}
        onClose={() => setPendingValue(null)}
        onConfirm={() => pendingValue !== null && save.mutate(pendingValue)}
      />
    </>
  );
}
