import type { SxProps, Theme } from '@mui/material/styles';

export const INLINE_EDIT_DOT_COLOR = 'rgba(37, 99, 235, 0.45)';

export const INLINE_EDIT_SAVE_HINT = 'Сохранится сразу после Enter или клика вне поля';

export function clickToEditTriggerSx(options?: {
  align?: 'left' | 'right' | 'center';
  emphasized?: boolean;
  fontStyle?: 'italic';
}): SxProps<Theme> {
  const align = options?.align ?? 'left';
  return {
    border: 0,
    bgcolor: 'transparent',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.25,
    cursor: 'pointer',
    p: 0,
    textAlign: align,
    width: '100%',
    minWidth: 0,
    display: 'block',
    color: options?.emphasized ? 'primary.main' : 'inherit',
    fontStyle: options?.fontStyle,
    textDecoration: 'underline dotted',
    textDecorationColor: INLINE_EDIT_DOT_COLOR,
  };
}

export function inlineEditTextFieldSx(options?: {
  align?: 'left' | 'right';
  multiline?: boolean;
}): SxProps<Theme> {
  const align = options?.align ?? 'left';
  const multiline = options?.multiline ?? false;
  return {
    width: '100%',
    minWidth: 0,
    '& .MuiInputBase-input': {
      py: multiline ? 0.35 : 0.2,
      px: 0.75,
      fontSize: 13,
      textAlign: align,
    },
  };
}

export function inlineEditSelectSx(): SxProps<Theme> {
  return {
    width: '100%',
    minWidth: 0,
    '& .MuiSelect-select': { py: 0.2, px: 0.75, fontSize: 12 },
  };
}
