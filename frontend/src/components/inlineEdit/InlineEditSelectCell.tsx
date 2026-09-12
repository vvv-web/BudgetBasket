import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import { useEffect, useState, type ReactNode } from 'react';
import { ClickToEditTrigger } from './ClickToEditTrigger';
import { inlineEditSelectSx } from './inlineEditStyles';

export function InlineEditSelectCell<T extends string>({
  value,
  editable,
  options,
  onCommit,
  display,
  ariaLabel = 'Выбор значения',
  tooltip = 'Нажмите, чтобы изменить',
}: {
  value: T;
  editable: boolean;
  options: Array<{ value: T; label: string }>;
  onCommit: (value: T) => void;
  display: ReactNode;
  ariaLabel?: string;
  tooltip?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const apply = (next: T) => {
    setEditing(false);
    if (next !== value) onCommit(next);
  };

  if (!editable) return <>{display}</>;

  if (!editing) {
    return (
      <ClickToEditTrigger emphasized={false} tooltip={tooltip} ariaLabel={ariaLabel} onActivate={() => setEditing(true)}>
        {display}
      </ClickToEditTrigger>
    );
  }

  return (
    <Select
      autoFocus
      open
      size="small"
      value={draft}
      onChange={(event: SelectChangeEvent<T>) => {
        const next = event.target.value as T;
        setDraft(next);
        apply(next);
      }}
      onClose={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      inputProps={{ 'aria-label': ariaLabel }}
      sx={inlineEditSelectSx()}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value} dense sx={{ fontSize: 12 }}>
          {option.label}
        </MenuItem>
      ))}
    </Select>
  );
}
