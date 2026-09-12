import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { ClickToEditTrigger } from './ClickToEditTrigger';
import { inlineEditTextFieldSx, INLINE_EDIT_SAVE_HINT } from './inlineEditStyles';

export function InlineEditTextCell({
  value,
  editable,
  onCommit,
  multiline = false,
  align = 'left',
  displayValue,
  placeholder = '—',
  ariaLabel,
  tooltip,
  pending = false,
  emphasizedWhenEmpty = false,
  fontStyle,
}: {
  value: string;
  editable: boolean;
  onCommit: (value: string) => void;
  multiline?: boolean;
  align?: 'left' | 'right';
  displayValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  tooltip?: string;
  pending?: boolean;
  emphasizedWhenEmpty?: boolean;
  fontStyle?: 'italic';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const display = displayValue ?? (value || placeholder);
  const commit = () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onCommit(draft);
  };

  if (!editable) {
    const content = (
      <Typography
        variant="body2"
        noWrap={!multiline}
        sx={{ fontSize: 13, lineHeight: 1.25, fontStyle, textAlign: align }}
      >
        {display}
      </Typography>
    );

    return multiline ? content : <Tooltip title={display || '—'}>{content}</Tooltip>;
  }

  if (!editing) {
    return (
      <ClickToEditTrigger
        align={align}
        emphasized={emphasizedWhenEmpty ? !value : true}
        fontStyle={fontStyle}
        tooltip={tooltip}
        ariaLabel={ariaLabel}
        onActivate={() => setEditing(true)}
      >
        {display}
      </ClickToEditTrigger>
    );
  }

  return (
    <TextField
      autoFocus
      size="small"
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      value={draft}
      disabled={pending}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !multiline) {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      onBlur={commit}
      inputProps={{ 'aria-label': ariaLabel }}
      sx={inlineEditTextFieldSx({ align, multiline })}
    />
  );
}
