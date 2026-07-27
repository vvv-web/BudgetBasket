import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

export type TableSortDirection = 'asc' | 'desc';

export type TableSortState<K extends string> = {
  column: K;
  direction: TableSortDirection;
} | null;

export type TableFilterOption = {
  value: string;
  label: string;
  count: number;
};

export type TableColumnDefinition<T, K extends string> = {
  id: K;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  hideable?: boolean;
  defaultVisible?: boolean;
  getValue: (row: T) => unknown;
  getFilterValue?: (row: T) => unknown;
  getSortValue?: (row: T) => string | number | boolean | null | undefined;
};

function measureFittedWidth(values: Array<string | number>, minimumWidth: number, maximumWidth: number) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return minimumWidth;
  context.font = '14px Roboto, Arial, sans-serif';
  const widest = Math.max(...values.map((value) => context.measureText(String(value)).width), 0);
  return Math.min(maximumWidth, Math.max(minimumWidth, Math.ceil(widest + 48)));
}

/** Upper bound for auto-fit only; manual drag-resize is unlimited. */
export const TABLE_COLUMN_MAX_WIDTH = 420;

export function useTableColumnWidths<K extends string>(
  initialWidths: Record<K, number>,
  minimumWidths: Record<K, number>,
  autoFitValues?: Partial<Record<K, Array<string | number>>>,
  maximumWidth: number = TABLE_COLUMN_MAX_WIDTH,
) {
  const [columnWidths, setColumnWidths] = useState<Record<K, number>>(() => ({ ...initialWidths }));
  const userAdjustedRef = useRef(false);
  const lastAutoFitKeyRef = useRef('');

  const autoFitColumns = (valuesByColumn: Partial<Record<K, Array<string | number>>>) => {
    setColumnWidths((current) => {
      const next = { ...current };
      (Object.keys(valuesByColumn) as K[]).forEach((columnId) => {
        const values = valuesByColumn[columnId];
        if (!values) return;
        next[columnId] = measureFittedWidth(values, minimumWidths[columnId], maximumWidth);
      });
      return next;
    });
  };

  const autoFitColumn = (columnId: K, values: Array<string | number>) => {
    autoFitColumns({ [columnId]: values } as Partial<Record<K, Array<string | number>>>);
  };

  const autoFitKey = useMemo(() => {
    if (!autoFitValues) return '';
    return (Object.keys(autoFitValues) as K[])
      .map((columnId) => `${columnId}:${(autoFitValues[columnId] || []).join('\u0001')}`)
      .join('|');
  }, [autoFitValues]);

  useLayoutEffect(() => {
    if (!autoFitValues || !autoFitKey || userAdjustedRef.current) return;
    if (autoFitKey === lastAutoFitKeyRef.current) return;
    lastAutoFitKeyRef.current = autoFitKey;
    autoFitColumns(autoFitValues);
  }, [autoFitKey, autoFitValues]);

  const resizeColumn = (columnId: K, event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    userAdjustedRef.current = true;
    const startX = event.clientX;
    const startWidth = columnWidths[columnId];
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.max(minimumWidths[columnId], startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetColumnWidths = () => {
    userAdjustedRef.current = false;
    lastAutoFitKeyRef.current = '';
    if (autoFitValues) {
      autoFitColumns(autoFitValues);
      lastAutoFitKeyRef.current = autoFitKey;
      return;
    }
    setColumnWidths({ ...initialWidths });
  };

  return {
    columnWidths,
    resetColumnWidths,
    resizeColumn,
    autoFitColumn,
    autoFitColumns,
  };
}

type UseTableColumnControlsOptions<T, K extends string> = {
  rows: T[];
  columns: TableColumnDefinition<T, K>[];
  initialSort?: TableSortState<K>;
};

const EMPTY_FILTER_VALUE = '__EMPTY__';

function compareValues(left: string | number | boolean | null | undefined, right: string | number | boolean | null | undefined) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' });
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function stringifyFilterValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return { key: EMPTY_FILTER_VALUE, label: 'Пусто' };
  }
  return { key: String(value), label: String(value) };
}

function buildInitialVisibility<K extends string>(columns: Pick<TableColumnDefinition<unknown, K>, 'id' | 'defaultVisible'>[]) {
  return columns.reduce((accumulator, column) => {
    accumulator[column.id] = column.defaultVisible ?? true;
    return accumulator;
  }, {} as Record<K, boolean>);
}

function buildInitialFilterValues<K extends string>(columns: { id: K }[]) {
  return columns.reduce((accumulator, column) => {
    accumulator[column.id] = null;
    return accumulator;
  }, {} as Record<K, string[] | null>);
}

function buildInitialFilterSearch<K extends string>(columns: { id: K }[]) {
  return columns.reduce((accumulator, column) => {
    accumulator[column.id] = '';
    return accumulator;
  }, {} as Record<K, string>);
}

export function useTableColumnControls<T, K extends string>({
  rows,
  columns,
  initialSort = null,
}: UseTableColumnControlsOptions<T, K>) {
  const [sort, setSort] = useState<TableSortState<K>>(initialSort);
  const [visibility, setVisibility] = useState<Record<K, boolean>>(() => buildInitialVisibility(columns));
  const [selectedFilterValues, setSelectedFilterValues] = useState<Record<K, string[] | null>>(() => buildInitialFilterValues(columns));
  const [filterSearchValues, setFilterSearchValues] = useState<Record<K, string>>(() => buildInitialFilterSearch(columns));

  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );

  const getColumnRawValue = (column: TableColumnDefinition<T, K>, row: T) =>
    column.getFilterValue ? column.getFilterValue(row) : column.getValue(row);

  const rowMatchesColumnFilter = (row: T, columnId: K, ignoredColumnId?: K) => {
    if (ignoredColumnId && ignoredColumnId === columnId) return true;
    const column = columnsById.get(columnId);
    if (!column || column.filterable === false) return true;
    const selectedValues = selectedFilterValues[columnId];
    if (!selectedValues || selectedValues.length === 0) return true;
    const option = stringifyFilterValue(getColumnRawValue(column, row));
    return selectedValues.includes(option.key);
  };

  const filterOptions = useMemo(() => {
    return columns.reduce((accumulator, column) => {
      const optionMap = new Map<string, TableFilterOption>();
      const optionSearch = normalizeSearch(filterSearchValues[column.id] || '');
      const scopedRows = rows.filter((row) => columns.every((candidate) => rowMatchesColumnFilter(row, candidate.id, column.id)));

      for (const row of scopedRows) {
        const option = stringifyFilterValue(getColumnRawValue(column, row));
        const existing = optionMap.get(option.key);
        if (existing) {
          existing.count += 1;
        } else {
          optionMap.set(option.key, { value: option.key, label: option.label, count: 1 });
        }
      }

      let options = [...optionMap.values()].sort((left, right) => compareValues(left.label, right.label));
      if (optionSearch) {
        options = options.filter((option) => option.label.toLocaleLowerCase('ru-RU').includes(optionSearch));
      }
      accumulator[column.id] = options;
      return accumulator;
    }, {} as Record<K, TableFilterOption[]>);
  }, [columns, columnsById, filterSearchValues, rows, selectedFilterValues]);

  const filteredRows = useMemo(
    () => rows.filter((row) => columns.every((column) => rowMatchesColumnFilter(row, column.id))),
    [columns, rows, selectedFilterValues],
  );

  const rowsWithControls = useMemo(() => {
    if (!sort) return filteredRows;

    const activeColumn = columnsById.get(sort.column);
    if (!activeColumn || activeColumn.sortable === false) return filteredRows;

    return [...filteredRows].sort((left, right) => {
      const leftValue = activeColumn.getSortValue ? activeColumn.getSortValue(left) : activeColumn.getValue(left);
      const rightValue = activeColumn.getSortValue ? activeColumn.getSortValue(right) : activeColumn.getValue(right);
      const result = compareValues(
        leftValue as string | number | boolean | null | undefined,
        rightValue as string | number | boolean | null | undefined,
      );
      return sort.direction === 'asc' ? result : -result;
    });
  }, [columnsById, filteredRows, sort]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => visibility[column.id] ?? true),
    [columns, visibility],
  );

  const hasActiveFilters = useMemo(
    () => Object.values(selectedFilterValues).some((value) => value !== null),
    [selectedFilterValues],
  );

  const isColumnFiltered = (columnId: K) => selectedFilterValues[columnId] !== null;

  const setFilterSearchValue = (columnId: K, value: string) => {
    setFilterSearchValues((current) => ({ ...current, [columnId]: value }));
  };

  const setAllFilterOptions = (columnId: K) => {
    setSelectedFilterValues((current) => ({ ...current, [columnId]: null }));
  };

  const clearColumnFilter = (columnId: K) => {
    setSelectedFilterValues((current) => ({ ...current, [columnId]: null }));
    setFilterSearchValues((current) => ({ ...current, [columnId]: '' }));
  };

  const toggleFilterOption = (columnId: K, optionValue: string) => {
    const availableValues = filterOptions[columnId].map((option) => option.value);
    setSelectedFilterValues((current) => {
      const currentValues = current[columnId];
      const normalizedCurrentValues = currentValues ?? availableValues;
      const nextValues = normalizedCurrentValues.includes(optionValue)
        ? normalizedCurrentValues.filter((value) => value !== optionValue)
        : [...normalizedCurrentValues, optionValue];

      if (nextValues.length === 0 || nextValues.length === availableValues.length) {
        return { ...current, [columnId]: null };
      }
      return { ...current, [columnId]: nextValues };
    });
  };

  const setVisibleFilterOptions = (columnId: K, includeAllVisible: boolean) => {
    const visibleOptionValues = filterOptions[columnId].map((option) => option.value);
    setSelectedFilterValues((current) => {
      const currentValues = current[columnId];
      const normalizedCurrentValues = currentValues ?? filterOptions[columnId].map((option) => option.value);
      const nextValues = includeAllVisible
        ? [...new Set([...normalizedCurrentValues, ...visibleOptionValues])]
        : normalizedCurrentValues.filter((value) => !visibleOptionValues.includes(value));

      const allValues = filterOptions[columnId].map((option) => option.value);
      if (nextValues.length === 0 || nextValues.length === allValues.length) {
        return { ...current, [columnId]: nextValues.length === 0 ? [] : null };
      }
      return { ...current, [columnId]: nextValues };
    });
  };

  const setSortAscending = (columnId: K) => setSort({ column: columnId, direction: 'asc' });
  const setSortDescending = (columnId: K) => setSort({ column: columnId, direction: 'desc' });
  const clearSort = (columnId?: K) => {
    setSort((current) => (!columnId || current?.column === columnId ? null : current));
  };

  const toggleVisibility = (columnId: K) => {
    const column = columnsById.get(columnId);
    if (!column || column.hideable === false) return;
    setVisibility((current) => ({ ...current, [columnId]: !current[columnId] }));
  };

  const resetFilters = () => {
    setSelectedFilterValues(buildInitialFilterValues(columns));
    setFilterSearchValues(buildInitialFilterSearch(columns));
    setSort(initialSort);
  };

  const resetVisibility = () => setVisibility(buildInitialVisibility(columns));

  return {
    clearColumnFilter,
    clearSort,
    filterOptions,
    filterSearchValues,
    hasActiveFilters,
    isColumnFiltered,
    resetFilters,
    resetVisibility,
    rows: rowsWithControls,
    selectedFilterValues,
    setAllFilterOptions,
    setFilterSearchValue,
    setSortAscending,
    setSortDescending,
    setVisibleFilterOptions,
    sort,
    toggleFilterOption,
    toggleVisibility,
    visibility,
    visibleColumns,
  };
}
