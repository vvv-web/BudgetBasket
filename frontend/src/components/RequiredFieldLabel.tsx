import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded';
import Box from '@mui/material/Box';

export function RequiredFieldLabel({ label }: { label: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <span>{label}</span>
      <PriorityHighRoundedIcon color="warning" sx={{ fontSize: 15 }} titleAccess="Обязательное поле" />
    </Box>
  );
}
