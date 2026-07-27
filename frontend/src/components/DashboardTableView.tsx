import FileDownloadIcon from '@mui/icons-material/FileDownload';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import { useEffect, useMemo, useState } from 'react';
import { TableColumnHeader, TableColumnResizeHandle, TableColumnTools } from './TableColumnControls';
import { downloadBlob } from '../utils/download';
import { useTableColumnControls, useTableColumnWidths, type TableColumnDefinition } from '../utils/tableColumns';

export type DashboardTableRow = {
  id: string;
  request_id: string;
  organization: string;
  cfo: string;
  unit: string;
  article: string;
  category: string;
  kind: 'dds' | 'invest';
  status: string;
  planned: number;
  approved: number;
};

type SummaryRow = {
  id: string;
  organization: string;
  cfo: string;
  article: string;
  requests_count: number;
  planned: number;
  approved: number;
};

type Column = 'cfo' | 'article' | 'requests_count' | 'planned' | 'approved' | 'correction';

const columnLabels: Record<Column, string> = {
  cfo: 'ЦФО', article: 'Статья расхода', requests_count: 'Заявок', planned: 'План', approved: 'Факт', correction: 'Корректировка',
};
const initialWidths: Record<Column, number> = {
  cfo: 260, article: 300, requests_count: 120, planned: 150, approved: 150, correction: 150,
};
const minimumWidths: Record<Column, number> = {
  cfo: 160, article: 180, requests_count: 100, planned: 120, approved: 120, correction: 120,
};

const numericAmount = (value: number) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);

function xmlEscape(value: string | number) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function excelColumn(index: number) {
  let value = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function sheetName(value: string, index: number, used: Set<string>) {
  const base = (value.replace(/[\\/*?:\[\]]/g, ' ').trim() || `Лист ${index + 1}`).slice(0, 31);
  let result = base;
  let suffix = 2;
  while (used.has(result)) {
    result = `${base.slice(0, 31 - String(suffix).length - 1)} ${suffix}`;
    suffix += 1;
  }
  used.add(result);
  return result;
}

export function DashboardTableView({ rows }: { rows: DashboardTableRow[] }) {
  const [columnOrder, setColumnOrder] = useState<Column[]>(['cfo', 'article', 'requests_count', 'planned', 'approved', 'correction']);
  const [draggedColumn, setDraggedColumn] = useState<Column | null>(null);
  const [organization, setOrganization] = useState('');
  const summaryRows = useMemo<SummaryRow[]>(() => {
    const grouped = new Map<string, SummaryRow & { requestIds: Set<string> }>();
    rows.forEach((row) => {
      const key = [row.organization, row.cfo, row.article, row.kind].join('\u0000');
      const item = grouped.get(key) || { id: key, organization: row.organization, cfo: row.cfo, article: row.article, requests_count: 0, planned: 0, approved: 0, requestIds: new Set<string>() };
      item.planned += row.planned;
      item.approved += row.approved;
      item.requestIds.add(row.request_id);
      item.requests_count = item.requestIds.size;
      grouped.set(key, item);
    });
    return [...grouped.values()].map(({ requestIds: _, ...row }) => row);
  }, [rows]);
  const columns = useMemo<TableColumnDefinition<SummaryRow, Column>[]>(() => {
    const result: TableColumnDefinition<SummaryRow, Column>[] = [
      { id: 'cfo', label: columnLabels.cfo, getValue: (row) => row.cfo },
      { id: 'article', label: columnLabels.article, getValue: (row) => row.article },
      { id: 'requests_count', label: columnLabels.requests_count, getValue: (row) => row.requests_count, getSortValue: (row) => row.requests_count },
      { id: 'planned', label: columnLabels.planned, getValue: (row) => numericAmount(row.planned), getSortValue: (row) => row.planned },
      { id: 'approved', label: columnLabels.approved, getValue: (row) => numericAmount(row.approved), getSortValue: (row) => row.approved },
      { id: 'correction', label: columnLabels.correction, getValue: (row) => numericAmount(row.approved - row.planned), getSortValue: (row) => row.approved - row.planned },
    ];
    return result.sort((left, right) => columnOrder.indexOf(left.id) - columnOrder.indexOf(right.id));
  }, [columnOrder]);
  const controls = useTableColumnControls({ rows: summaryRows, columns });
  const organizations = useMemo(() => [...new Set(summaryRows.map((row) => row.organization))].sort((left, right) => left.localeCompare(right, 'ru')), [summaryRows]);
  useEffect(() => {
    if (!organization || !organizations.includes(organization)) setOrganization(organizations[0] || '');
  }, [organization, organizations]);
  const sheetRows = useMemo(() => controls.rows.filter((row) => row.organization === organization), [controls.rows, organization]);
  const autoFitValues = useMemo(() => columns.reduce((values, column) => {
    values[column.id] = [column.label, ...controls.rows.map((row) => String(column.getValue(row)))];
    return values;
  }, {} as Record<Column, Array<string | number>>), [columns, controls.rows]);
  const { columnWidths, resetColumnWidths, resizeColumn, autoFitColumn } = useTableColumnWidths(initialWidths, minimumWidths, autoFitValues);
  const tableWidth = controls.visibleColumns.reduce((total, column) => total + columnWidths[column.id], 0);

  const value = (row: SummaryRow, column: Column) => {
    if (column === 'planned') return numericAmount(row.planned);
    if (column === 'approved') return numericAmount(row.approved);
    if (column === 'correction') return numericAmount(row.approved - row.planned);
    return row[column];
  };
  const numericValue = (row: SummaryRow, column: Column) => {
    if (column === 'requests_count') return row.requests_count;
    if (column === 'planned') return row.planned;
    if (column === 'approved') return row.approved;
    if (column === 'correction') return row.approved - row.planned;
    return null;
  };
  const exportCurrentView = async () => {
    const { default: JSZip } = await import('jszip');
    const groups = new Map<string, SummaryRow[]>();
    controls.rows.forEach((row) => groups.set(row.organization, [...(groups.get(row.organization) || []), row]));
    const zip = new JSZip();
    const usedNames = new Set<string>();
    const sheetEntries = [...groups.entries()];
    sheetEntries.forEach(([organization, sheetRows], index) => {
      const cells = [
        controls.visibleColumns.map((column, columnIndex) => `<c r="${excelColumn(columnIndex)}1" t="inlineStr"><is><t>${xmlEscape(column.label)}</t></is></c>`).join(''),
        ...sheetRows.map((row, rowIndex) => `<row r="${rowIndex + 2}">${controls.visibleColumns.map((column, columnIndex) => {
          const raw = numericValue(row, column.id);
          return raw === null
            ? `<c r="${excelColumn(columnIndex)}${rowIndex + 2}" t="inlineStr"><is><t>${xmlEscape(value(row, column.id))}</t></is></c>`
            : `<c r="${excelColumn(columnIndex)}${rowIndex + 2}"><v>${raw}</v></c>`;
        }).join('')}</row>`),
      ];
      zip.file(`xl/worksheets/sheet${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells[0]}</row>${cells.slice(1).join('')}</sheetData></worksheet>`);
      sheetEntries[index][0] = sheetName(organization, index, usedNames);
    });
    const sheets = sheetEntries.map(([name], index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    const relationships = sheetEntries.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
    const overrides = sheetEntries.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
    downloadBlob(await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'сводка-заявок.xlsx');
  };
  const moveColumn = (target: Column) => {
    if (!draggedColumn || draggedColumn === target) return;
    setColumnOrder((current) => {
      const next = current.filter((column) => column !== draggedColumn);
      next.splice(next.indexOf(target), 0, draggedColumn);
      return next;
    });
    setDraggedColumn(null);
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
        <Tabs value={organization} onChange={(_, nextOrganization: string) => setOrganization(nextOrganization)} variant="scrollable" scrollButtons="auto" aria-label="Листы организаций и подразделений" sx={{ minHeight: 48, flex: 1 }}>
          {organizations.map((item) => <Tab key={item} value={item} label={item} />)}
        </Tabs>
        <Stack direction="row" spacing={1}>
          <TableColumnTools columns={columns} visibility={controls.visibility} onToggleColumn={controls.toggleVisibility} onResetColumns={controls.resetVisibility} onResetFilters={controls.resetFilters} onResetWidths={resetColumnWidths} hasActiveFilters={controls.hasActiveFilters} />
          <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => void exportCurrentView()}>Экспорт Excel</Button>
        </Stack>
      </Stack>
      <Paper className="table-surface" elevation={0}>
        <Table size="small" sx={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>{controls.visibleColumns.map((column) => <col key={column.id} style={{ width: columnWidths[column.id] }} />)}</colgroup>
          <TableHead><TableRow>{controls.visibleColumns.map((column) => (
            <TableCell key={column.id} draggable onDragStart={() => setDraggedColumn(column.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveColumn(column.id)} sx={{ position: 'relative', cursor: 'grab', '&:active': { cursor: 'grabbing' } }}>
              <TableColumnHeader label={column.label} sortDirection={controls.sort?.column === column.id ? controls.sort.direction : null} onSortAscending={() => controls.setSortAscending(column.id)} onSortDescending={() => controls.setSortDescending(column.id)} onClearSort={() => controls.clearSort(column.id)} filterOptions={controls.filterOptions[column.id]} selectedFilterValues={controls.selectedFilterValues[column.id]} filterSearchValue={controls.filterSearchValues[column.id]} onFilterSearchChange={(next) => controls.setFilterSearchValue(column.id, next)} onToggleFilterValue={(next) => controls.toggleFilterOption(column.id, next)} onSelectAllFilterValues={() => controls.setAllFilterOptions(column.id)} onClearColumnFilter={() => controls.clearColumnFilter(column.id)} onClearVisibleFilterValues={() => controls.setVisibleFilterOptions(column.id, false)} />
              <TableColumnResizeHandle onPointerDown={(event) => resizeColumn(column.id, event)} onDoubleClick={() => autoFitColumn(column.id, autoFitValues[column.id])} />
            </TableCell>
          ))}</TableRow></TableHead>
          <TableBody>{sheetRows.length ? sheetRows.map((row) => <TableRow key={row.id}>{controls.visibleColumns.map((column) => <TableCell key={column.id} align={column.id === 'planned' || column.id === 'approved' || column.id === 'correction' || column.id === 'requests_count' ? 'right' : undefined}>{value(row, column.id)}</TableCell>)}</TableRow>) : (
            <TableRow><TableCell colSpan={controls.visibleColumns.length || 1} align="center">По выбранным фильтрам строки не найдены</TableCell></TableRow>
          )}</TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
