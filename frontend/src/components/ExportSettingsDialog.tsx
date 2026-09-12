import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import type { RequestStatus, Unit } from '../types';
import { requestStatusLabels } from '../utils/labels';
import type { ExportKind, ExportSettingsState } from '../utils/exportSettings';

export function ExportSettingsDialog({
  open,
  settings,
  units,
  statusOptions,
  filterNote,
  exporting = false,
  onClose,
  onChange,
  onExport,
}: {
  open: boolean;
  settings: ExportSettingsState;
  units: Unit[];
  statusOptions: RequestStatus[];
  filterNote: string;
  exporting?: boolean;
  onClose: () => void;
  onChange: (next: ExportSettingsState) => void;
  onExport: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [expandedDepartments, setExpandedDepartments] = useState<string[]>([]);
  const departments = useMemo(() => units.filter((unit) => !unit.parent_id), [units]);
  const modulesByDepartment = useMemo(
    () => new Map(departments.map((department) => [department.id, units.filter((unit) => unit.parent_id === department.id)])),
    [departments, units],
  );
  useEffect(() => {
    if (!open) return;
    const parents = units.flatMap((unit) => (
      unit.parent_id && (settings.module_ids.includes(unit.id) || settings.department_ids.includes(unit.id))
        ? [unit.parent_id]
        : []
    ));
    if (!parents.length) return;
    setExpandedDepartments((current) => [...new Set([...current, ...parents])]);
  }, [open, settings.department_ids, settings.module_ids, units]);

  const toggleStatus = (status: RequestStatus) => {
    onChange({
      ...settings,
      statuses: settings.statuses.includes(status)
        ? settings.statuses.filter((item) => item !== status)
        : [...settings.statuses, status],
    });
  };
  const toggleDepartment = (departmentId: string) => {
    onChange({
      ...settings,
      department_ids: settings.department_ids.includes(departmentId)
        ? settings.department_ids.filter((id) => id !== departmentId)
        : [...settings.department_ids, departmentId],
    });
  };
  const toggleModule = (moduleId: string) => {
    onChange({
      ...settings,
      module_ids: settings.module_ids.includes(moduleId)
        ? settings.module_ids.filter((id) => id !== moduleId)
        : [...settings.module_ids, moduleId],
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} className="export-dialog">
      <DialogTitle>Настройки экспорта</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Alert severity="info" variant="outlined">{filterNote}</Alert>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography fontWeight={700}>Состав выгрузки</Typography>
              <Tooltip title="Выберите, включать в экспорт доходы, расходы или оба вида строк.">
                <IconButton size="small" aria-label="Нюансы состава выгрузки"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            <TextField
              select
              label="Состав выгрузки"
              value={settings.export_kind}
              onChange={(event) => onChange({ ...settings, export_kind: event.target.value as ExportKind })}
              fullWidth
              sx={{ mt: 1 }}
            >
              <MenuItem value="all">Доходы и расходы</MenuItem>
              <MenuItem value="expense">Только расходы</MenuItem>
              <MenuItem value="income">Только доходы</MenuItem>
            </TextField>
          </Stack>

          <Stack spacing={0.75}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography fontWeight={700}>Объединения</Typography>
              <Tooltip title="Отметьте объединение, чтобы включить все его дочерние объединения, или отметьте только нужные. Без выбора экспортируются все доступные объединения.">
                <IconButton size="small" aria-label="Нюансы выбора области экспорта"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            <FormGroup sx={{ mt: 0.5 }}>
              {departments.map((department) => {
                const departmentSelected = settings.department_ids.includes(department.id);
                const modules = modulesByDepartment.get(department.id) || [];
                const modulesExpanded = expandedDepartments.includes(department.id);
                return (
                  <Stack key={department.id} spacing={0}>
                    <Stack direction="row" alignItems="center">
                      <FormControlLabel
                        sx={{ flex: 1, mr: 0 }}
                        control={<Checkbox checked={departmentSelected} onChange={() => toggleDepartment(department.id)} />}
                        label={department.name}
                      />
                      {modules.length > 0 && (
                        <IconButton
                          size="small"
                          aria-label={`${modulesExpanded ? 'Скрыть' : 'Показать'} дочерние объединения ${department.name}`}
                          onClick={() => setExpandedDepartments((current) => (
                            current.includes(department.id)
                              ? current.filter((id) => id !== department.id)
                              : [...current, department.id]
                          ))}
                        >
                          <ExpandMoreIcon sx={{ transform: modulesExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} />
                        </IconButton>
                      )}
                    </Stack>
                    <Collapse in={modulesExpanded} timeout="auto" unmountOnExit>
                      <FormGroup>
                        {modules.map((module) => (
                          <FormControlLabel
                            key={module.id}
                            sx={{ ml: 3 }}
                            control={<Checkbox checked={departmentSelected || settings.module_ids.includes(module.id)} disabled={departmentSelected} onChange={() => toggleModule(module.id)} />}
                            label={module.name}
                          />
                        ))}
                      </FormGroup>
                    </Collapse>
                  </Stack>
                );
              })}
            </FormGroup>
          </Stack>

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography fontWeight={700}>Заявки и статусы</Typography>
              <Tooltip title="Список статусов подстраивается под фильтры страницы. Снимите лишние, если нужно сузить выгрузку.">
                <IconButton size="small" aria-label="Нюансы статусов экспорта"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            <FormGroup sx={{ mt: 0.5 }}>
              {statusOptions.map((status) => (
                <FormControlLabel
                  key={status}
                  control={<Checkbox checked={settings.statuses.includes(status)} onChange={() => toggleStatus(status)} />}
                  label={requestStatusLabels[status]}
                />
              ))}
            </FormGroup>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
              <FormControlLabel
                sx={{ mr: 0 }}
                control={<Switch checked={settings.fixed_only} onChange={(event) => onChange({ ...settings, fixed_only: event.target.checked })} />}
                label="Экспортировать только зафиксированные заявки"
              />
              <Tooltip title="В выгрузку попадут только заявки с зафиксированным бюджетом среди выбранных статусов.">
                <IconButton size="small" aria-label="Нюансы экспорта зафиксированных заявок"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Stack spacing={0.25}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <FormControlLabel
                sx={{ mr: 0 }}
                control={<Switch checked={settings.include_files} onChange={(event) => onChange({ ...settings, include_files: event.target.checked })} />}
                label="Включить прикреплённые файлы"
              />
              <Tooltip title="С файлами выгружается ZIP-архив: Excel и папка вложений. Без файлов будет скачан только Excel.">
                <IconButton size="small" aria-label="Нюансы выгрузки файлов"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          startIcon={<FileDownloadIcon />}
          onClick={onExport}
          disabled={settings.statuses.length === 0 || exporting}
        >
          {exporting ? 'Выгрузка…' : 'Экспортировать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
