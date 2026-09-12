import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import type { ReactNode } from 'react';
import { clickToEditTriggerSx, INLINE_EDIT_SAVE_HINT } from './inlineEditStyles';

export function ClickToEditTrigger({
  children,
  tooltip,
  ariaLabel,
  align = 'left',
  emphasized = true,
  fontStyle,
  onActivate,
}: {
  children: ReactNode;
  tooltip?: string;
  ariaLabel?: string;
  align?: 'left' | 'right' | 'center';
  emphasized?: boolean;
  fontStyle?: 'italic';
  onActivate: () => void;
}) {
  const content = (
    <Box
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onActivate();
      }}
      aria-label={ariaLabel}
      sx={clickToEditTriggerSx({ align, emphasized, fontStyle })}
    >
      {children}
    </Box>
  );

  return <Tooltip title={tooltip || INLINE_EDIT_SAVE_HINT}>{content}</Tooltip>;
}
