import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Fragment, useMemo, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type {
  TableColumnDefinition,
  TableFilterOption,
  TableSortDirection,
} from '../utils/tableColumns';

type ColumnMeta<K extends string> = Pick<TableColumnDefinition<unknown, K>, 'id' | 'label' | 'hideable'>;

function filterOptionLineCount(label: string): number {
  const maxCharactersPerLine = 18;
  let lines = 1;
  let currentLineLength = 0;

  for (const word of label.split(/\s+/)) {
    const wordLines = Math.ceil(word.length / maxCharactersPerLine);
    const wordLength = Math.min(word.length, maxCharactersPerLine);
    if (currentLineLength && currentLineLength + wordLength + 1 > maxCharactersPerLine) {
      lines += 1;
      currentLineLength = 0;
    }
    currentLineLength += wordLength + (currentLineLength ? 1 : 0);
    lines += wordLines - 1;
    if (wordLines > 1) currentLineLength = word.length % maxCharactersPerLine || maxCharactersPerLine;
  }

  return lines;
}

export function TableColumnTools<K extends string>({
  columns,
  visibility,
  onToggleColumn,
  onResetColumns,
  onResetFilters,
  onResetWidths,
  hasActiveFilters = false,
  buttonLabel,
}: {
  columns: ColumnMeta<K>[];
  visibility: Record<K, boolean>;
  onToggleColumn: (columnId: K) => void;
  onResetColumns?: () => void;
  onResetFilters?: () => void;
  onResetWidths?: () => void;
  hasActiveFilters?: boolean;
  buttonLabel?: string;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const visibleHideableCount = columns.filter((column) => column.hideable !== false && visibility[column.id]).length;
  const hasHiddenColumns = columns.some((column) => column.hideable !== false && visibility[column.id] === false);

  return (
    <>
      {buttonLabel ? (
        <Button
          size="small"
          variant="outlined"
          color={hasActiveFilters || hasHiddenColumns ? 'primary' : 'inherit'}
          startIcon={<ViewColumnOutlinedIcon fontSize="small" />}
          endIcon={<ArrowDropDownIcon fontSize="small" />}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          {buttonLabel}
        </Button>
      ) : <Tooltip title="Настройки таблицы">
        <IconButton
          size="small"
          color={hasActiveFilters || hasHiddenColumns ? 'primary' : 'default'}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          aria-label="Настройки таблицы"
          sx={{
            width: 40,
            height: 40,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '50%',
            bgcolor: 'background.paper',
          }}
        >
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>}
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem disabled>
          <ViewColumnOutlinedIcon fontSize="small" />
          <ListItemText sx={{ ml: 1 }}>Колонки</ListItemText>
        </MenuItem>
        {columns.map((column) => {
          const checked = visibility[column.id] ?? true;
          const disableHide = column.hideable === false || (checked && visibleHideableCount === 1);
          return (
            <MenuItem key={column.id} onClick={() => !disableHide && onToggleColumn(column.id)} disabled={disableHide}>
              <Checkbox edge="start" checked={checked} disableRipple disabled={disableHide} />
              <ListItemText>{column.label}</ListItemText>
            </MenuItem>
          );
        })}
        {(onResetColumns || onResetFilters || onResetWidths) && (
          <>
            <Divider />
            <MenuItem onClick={() => { onResetColumns?.(); onResetFilters?.(); onResetWidths?.(); setAnchorEl(null); }}>
              <ListItemText>Сбросить настройки таблицы</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}

export function TableColumnResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  onDoubleClick?: () => void;
}) {
  return (
    <Tooltip title="Перетащите для изменения ширины; дважды нажмите для подбора по содержимому" placement="top" enterDelay={500}>
      <Box
        component="span"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину столбца"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          zIndex: 6,
          width: 4,
          cursor: 'col-resize',
          touchAction: 'none',
          transform: 'translateX(50%)',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            borderRadius: 0,
            bgcolor: 'transparent',
            transition: 'background-color 120ms ease',
          },
          '&:hover::after': {
            bgcolor: 'primary.main',
          },
        }}
      />
    </Tooltip>
  );
}

export function TableColumnHeader({
  label,
  sortable = true,
  filterable = true,
  sortDirection = null,
  onSortAscending,
  onSortDescending,
  onClearSort,
  filterOptions = [],
  selectedFilterValues = null,
  filterSearchValue = '',
  onFilterSearchChange,
  onToggleFilterValue,
  onSelectAllFilterValues,
  onClearColumnFilter,
  onClearVisibleFilterValues,
  formatFilterOptionLabel,
  filterOptionSection,
  endAdornment,
  onOpenFilter,
}: {
  label: ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  sortDirection?: TableSortDirection | null;
  onSortAscending?: () => void;
  onSortDescending?: () => void;
  onClearSort?: () => void;
  filterOptions?: TableFilterOption[];
  selectedFilterValues?: string[] | null;
  filterSearchValue?: string;
  onFilterSearchChange?: (value: string) => void;
  onToggleFilterValue?: (value: string) => void;
  onSelectAllFilterValues?: () => void;
  onClearColumnFilter?: () => void;
  onClearVisibleFilterValues?: () => void;
  formatFilterOptionLabel?: (option: TableFilterOption) => string;
  filterOptionSection?: (option: TableFilterOption) => string | null;
  endAdornment?: ReactNode;
  onOpenFilter?: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const selectedValues = selectedFilterValues ?? filterOptions.map((option) => option.value);
  const allVisibleSelected = filterOptions.length > 0 && filterOptions.every((option) => selectedValues.includes(option.value));
  const columnFiltered = selectedFilterValues !== null;
  const columnSorted = !!sortDirection;
  const menuActive = columnFiltered;
  const hasColumnControls = sortable || filterable;
  const optionLabel = (option: TableFilterOption) => formatFilterOptionLabel?.(option) || option.label;
  const displayedFilterOptions = useMemo(() => {
    if (!filterOptionSection) return filterOptions;
    const withSections = filterOptions.map((option, index) => ({
      option,
      index,
      section: filterOptionSection(option) || '',
    }));
    if (!withSections.some(({ section }) => section)) return filterOptions;
    return withSections
      .sort((left, right) => left.section.localeCompare(right.section, 'ru') || left.index - right.index)
      .map(({ option }) => option);
  }, [filterOptionSection, filterOptions]);

  const filterSummary = useMemo(() => {
    if (!columnFiltered) return 'Все значения';
    if (selectedValues.length === 0) return 'Нет выбранных значений';
    if (selectedValues.length === 1) {
      const option = filterOptions.find((entry) => entry.value === selectedValues[0]);
      return option ? optionLabel(option) : '1 значение';
    }
    return `Выбрано: ${selectedValues.length}`;
  }, [columnFiltered, filterOptions, formatFilterOptionLabel, selectedValues]);

  const openFilterMenu = (event: MouseEvent<HTMLElement>) => {
    onOpenFilter?.();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const toggleSort = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!onSortAscending) return;
    if (sortDirection === 'asc') {
      onSortDescending?.();
    } else if (sortDirection === 'desc') {
      onClearSort?.();
    } else {
      onSortAscending();
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          minWidth: 0,
          gap: 0.25,
          pr: endAdornment ? 1.5 : 0,
        }}
      >
        <Typography
          component="span"
          variant="body2"
          fontWeight={600}
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.25,
          }}
        >
          {label}
        </Typography>
        {hasColumnControls ? (
          <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
            {sortable && (
              <Tooltip title={columnSorted ? 'Изменить направление сортировки' : 'Сортировать'}>
                <IconButton
                  className="column-sort-button"
                  size="small"
                  color={columnSorted ? 'primary' : 'default'}
                  onClick={toggleSort}
                  aria-label={columnSorted ? 'Изменить направление сортировки' : 'Сортировать'}
                  sx={{ opacity: columnSorted ? 1 : 0.72, p: 0.35 }}
                >
                  <ArrowDownwardIcon
                    fontSize="inherit"
                    sx={{
                      opacity: columnSorted ? 1 : 0.6,
                      transform: sortDirection === 'asc' ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </IconButton>
              </Tooltip>
            )}
            {filterable && (
              <Tooltip title={menuActive ? filterSummary : 'Фильтр'}>
                <IconButton size="small" color={menuActive ? 'primary' : 'default'} onClick={openFilterMenu} aria-label={menuActive ? filterSummary : 'Фильтр'} sx={{ p: 0.35 }}>
                  {columnFiltered ? <FilterAltOutlinedIcon fontSize="inherit" /> : <ArrowDropDownIcon fontSize="inherit" />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ) : null}
        {endAdornment}
      </Box>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Stack spacing={1.25} sx={{ p: 1.5, width: 320 }}>
          <Typography variant="subtitle2">{label}</Typography>

          {filterable && (
            <>
              <TextField
                size="small"
                label="Поиск значений"
                value={filterSearchValue}
                onChange={(event) => onFilterSearchChange?.(event.target.value)}
                autoFocus
              />
              <Stack direction="row" spacing={1} justifyContent="space-between">
                <Button size="small" onClick={onSelectAllFilterValues}>
                  Выбрать все
                </Button>
                <Button size="small" onClick={onClearVisibleFilterValues} disabled={filterOptions.length === 0 || !allVisibleSelected}>
                  Снять видимые
                </Button>
                <Button size="small" onClick={onClearColumnFilter} disabled={!columnFiltered}>
                  Сбросить
                </Button>
              </Stack>
              <Stack spacing={0} sx={{ maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(15, 23, 42, 0.08)', borderRadius: 1 }}>
                {displayedFilterOptions.length > 0 ? (
                  displayedFilterOptions.map((option, index) => {
                    const checked = selectedValues.includes(option.value);
                    const labelText = optionLabel(option);
                    const lineCount = filterOptionLineCount(labelText);
                    const section = filterOptionSection?.(option);
                    const previousSection = index > 0 ? filterOptionSection?.(displayedFilterOptions[index - 1]) : null;
                    return (
                      <Fragment key={option.value}>
                        {section && section !== previousSection && (
                          <Typography variant="overline" sx={{
                            display: 'block',
                            px: 1.5,
                            pt: index ? 1.5 : 0.9,
                            pb: 0.7,
                            mt: index ? 0.5 : 0,
                            color: 'primary.dark',
                            bgcolor: 'rgba(47, 105, 230, 0.07)',
                            borderTop: index ? '1px solid rgba(47, 105, 230, 0.18)' : undefined,
                            borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: 0.45,
                            lineHeight: 1.2,
                          }}>
                            {section}
                          </Typography>
                        )}
                        <Box
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          tabIndex={0}
                          onClick={() => onToggleFilterValue?.(option.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onToggleFilterValue?.(option.value);
                            }
                          }}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '40px 64px minmax(0, 1fr)',
                            alignItems: 'center',
                            width: '100%',
                            minHeight: Math.max(44, lineCount * 22 + 16),
                            boxSizing: 'border-box',
                            cursor: 'pointer',
                            textAlign: 'left',
                            py: 0.75,
                            px: 1.5,
                            '&:hover': { bgcolor: 'action.hover' },
                            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                          }}
                        >
                          <Checkbox edge="start" checked={checked} disableRipple sx={{ ml: -0.5 }} />
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ pr: 1, lineHeight: 1.25 }}
                          >
                            {option.count > 1 ? `${option.count} строк` : '1 строка'}
                          </Typography>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                              {labelText}
                            </Typography>
                          </Box>
                        </Box>
                      </Fragment>
                    );
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                    Значения не найдены
                  </Typography>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </Popover>
    </>
  );
}
