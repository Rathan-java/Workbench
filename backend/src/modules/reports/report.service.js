/**
 * Report generation — Excel, CSV, PDF.
 *
 * ── EVERYTHING IS STREAMED ───────────────────────────────────────────────────
 * A 20,000-row export built in memory as an array of objects, then serialised to
 * a Buffer, then written to the response, holds three copies of the dataset in
 * RAM at once. Do that from four managers simultaneously on an Azure B2 instance
 * and the process is OOM-killed. So: we page through the data in chunks and
 * write each chunk straight to the HTTP response as it is produced. Constant
 * memory, and the browser starts receiving bytes immediately.
 *
 * ── EXPORTS ARE SCOPED AND AUDITED ───────────────────────────────────────────
 * An export endpoint that forgets its scope hands a Tech Lead a spreadsheet of
 * the entire company. Every query here goes through the same scopeWhere() as the
 * screen it mirrors, and every export writes an audit row: exporting data is an
 * event a compliance officer will one day want to see.
 *
 * ── ROW CAP ──────────────────────────────────────────────────────────────────
 * Exports are capped and the cap is REPORTED in the file. A silently truncated
 * report is worse than a refused one — the recipient has no idea they are
 * looking at a fraction of the data.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and } from '../../core/pagination.js';
import { buildDateFilter } from '../tasks/task.repository.js';
import { getTableColumns } from '../tasks/taskAttributes.js';
import { formatWorkDate, humanDate, dayjs } from '../../utils/date.js';
import { env } from '../../config/env.js';
import * as audit from '../audit/audit.service.js';
import { fullName } from '../../utils/name.js';
import { logger } from '../../config/logger.js';
import { BadRequestError } from '../../core/errors.js';

const MAX_ROWS = 50_000;
const CHUNK = 500;

const ENTRY_INCLUDE = {
  timeSlot: { select: { label: true, sortOrder: true } },
  user: { select: { firstName: true, lastName: true, employeeCode: true } },
  department: { select: { name: true } },
  team: { select: { name: true } },
  project: { select: { code: true, name: true } },
  updatedBy: { select: { firstName: true, lastName: true } },
  taskDay: { select: { status: true } },
};

const buildWhere = (scope, filters) =>
  and(
    scopedWhereWithFilters(scope, {
      departmentId: filters.departmentId,
      teamId: filters.teamId,
      userId: filters.userId,
    }),
    buildDateFilter(filters),
    // Project is the axis management slices the work by, so an export has to be
    // narrowable to a single project — "send me everything we billed to ACME".
    filters.projectId ? { projectId: filters.projectId } : undefined,
    filters.isLate !== undefined ? { isLate: filters.isLate } : undefined,
  );

/**
 * Async generator over the result set, one page at a time.
 * Keyset pagination on (workDate, id) rather than OFFSET: at row 40,000 a
 * `LIMIT 500 OFFSET 40000` makes MySQL walk and discard 40,000 rows for every
 * single chunk. Keyset pagination stays O(chunk) all the way down.
 */
async function* streamEntries(where, limit = MAX_ROWS) {
  let cursor = null;
  let emitted = 0;

  while (emitted < limit) {
    const page = await prisma.taskEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ workDate: 'desc' }, { id: 'asc' }],
      take: Math.min(CHUNK, limit - emitted),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (!page.length) return;

    for (const row of page) yield row;

    emitted += page.length;
    cursor = page.at(-1).id;

    if (page.length < CHUNK) return;
  }

  logger.warn('Export hit the row cap', { limit });
}

/** Resolve the extra columns this department wants (campaign, platform, …). */
const resolveDynamicColumns = async (filters) => {
  if (!filters.departmentId) return [];
  return getTableColumns(filters.departmentId);
};

const flatten = (e, dynamicColumns) => {
  const base = {
    date: formatWorkDate(e.workDate),
    hour: e.timeSlot?.label ?? '',
    // A deleted employee's work is PRESERVED, so `user` may be null while the row
    // still carries the name stamped onto it at delete time. Exporting a blank
    // cell here would silently anonymise months of real work in every spreadsheet
    // — the work would technically still be there, and be useless.
    employee: e.user
      ? fullName(e.user)
      : (e.employeeName ?? 'Former employee'),
    employeeCode: e.user?.employeeCode ?? e.employeeCode ?? '',
    department: e.department?.name ?? '',
    team: e.team?.name ?? '',
    // Code AND name: the code is what finance reconciles against, the name is
    // what the recipient actually recognises. One without the other gets queried.
    project: e.project ? `${e.project.code} — ${e.project.name}` : '',
    description: e.description,
    remarks: e.remarks ?? '',
    late: e.isLate ? 'Yes' : 'No',
    approvalStatus: e.taskDay?.status ?? '',
    updatedBy: e.updatedBy ? fullName(e.updatedBy) : '',
    updatedAt: dayjs(e.updatedAt).format('YYYY-MM-DD HH:mm'),
  };

  for (const col of dynamicColumns) {
    const value = e.attributes?.[col.key];
    base[col.key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }

  return base;
};

const BASE_COLUMNS = [
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Hour', key: 'hour', width: 15 },
  { header: 'Employee', key: 'employee', width: 24 },
  { header: 'Emp. Code', key: 'employeeCode', width: 12 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Team', key: 'team', width: 18 },
  { header: 'Project', key: 'project', width: 34 },
  { header: 'Work Done', key: 'description', width: 60 },
  { header: 'Remarks', key: 'remarks', width: 30 },
  { header: 'Late', key: 'late', width: 7 },
  { header: 'Approval', key: 'approvalStatus', width: 12 },
  { header: 'Updated By', key: 'updatedBy', width: 22 },
  { header: 'Updated At', key: 'updatedAt', width: 18 },
];

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export const exportExcel = async (scope, filters, res, actor) => {
  const where = buildWhere(scope, filters);
  const dynamicColumns = await resolveDynamicColumns(filters);

  // The streaming writer flushes each row to the response as it is added, so
  // peak memory is one row, not the whole workbook.
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: false, // shared strings would require buffering everything
  });

  workbook.creator = env.APP_NAME;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Task Report', {
    views: [{ state: 'frozen', ySplit: 1 }], // header stays put when scrolling
  });

  sheet.columns = [
    ...BASE_COLUMNS,
    ...dynamicColumns.map((c) => ({ header: c.label, key: c.key, width: 22 })),
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  header.commit();

  let rows = 0;
  for await (const entry of streamEntries(where)) {
    const row = sheet.addRow(flatten(entry, dynamicColumns));

    // Project is what the report is read BY — bold it so the eye lands on it
    // when scanning a thousand rows.
    row.getCell('project').font = { bold: true };
    // Amber, not red: a late entry is a nudge, not a failure. Red is reserved.
    if (entry.isLate) {
      row.getCell('late').font = { color: { argb: 'FFB45309' }, bold: true };
    }

    row.commit();
    rows += 1;
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  await sheet.commit();
  await workbook.commit();

  recordExport(actor, 'EXCEL', rows, filters);
  return rows;
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * CSV escaping, done by hand and done properly.
 *
 * The `'` prefix on values starting with = + - @ is CSV INJECTION defence: Excel
 * evaluates `=cmd|'/c calc'!A1` as a formula when the file is opened. An
 * employee can type that into a task description, and the manager who opens the
 * export is the victim. This is a real, routinely-exploited vulnerability, and
 * it is why the export cannot just `join(',')`.
 */
const csvCell = (value) => {
  const s = String(value ?? '');
  const dangerous = /^[=+\-@\t\r]/.test(s);
  const escaped = (dangerous ? `'${s}` : s).replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
};

const UTF8_BOM = String.fromCharCode(0xfeff);

export const exportCsv = async (scope, filters, res, actor) => {
  const where = buildWhere(scope, filters);
  const dynamicColumns = await resolveDynamicColumns(filters);

  const columns = [
    ...BASE_COLUMNS,
    ...dynamicColumns.map((c) => ({ header: c.label, key: c.key })),
  ];

  // Excel opens a UTF-8 CSV as Windows-1252 unless the file starts with a byte
  // order mark — without this, every accented name in the company arrives as
  // mojibake. BOM is built from its code point rather than typed as a literal:
  // a literal BOM is invisible in an editor and gets silently stripped by any
  // formatter or git filter that normalises the file, and nobody notices until
  // a manager opens an export and sees "AndrÃ©".
  res.write(UTF8_BOM);
  res.write(`${columns.map((c) => csvCell(c.header)).join(',')}\n`);

  let rows = 0;
  for await (const entry of streamEntries(where)) {
    const flat = flatten(entry, dynamicColumns);
    res.write(`${columns.map((c) => csvCell(flat[c.key])).join(',')}\n`);
    rows += 1;
  }

  res.end();

  recordExport(actor, 'CSV', rows, filters);
  return rows;
};

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PDF_COLUMNS = [
  { key: 'date', label: 'Date', width: 58 },
  { key: 'hour', label: 'Hour', width: 68 },
  { key: 'employee', label: 'Employee', width: 100 },
  { key: 'project', label: 'Project', width: 150 },
  { key: 'description', label: 'Work Done', width: 235 },
  { key: 'approvalStatus', label: 'Approval', width: 60 },
  { key: 'late', label: 'Late', width: 30 },
];

/**
 * PDF is for signing and filing, not for analysis — so it is capped hard at
 * 2,000 rows. Nobody reads a 900-page PDF, and generating one blocks the event
 * loop for minutes. If a user wants everything, they want Excel, and we tell
 * them so in the document itself.
 */
const PDF_MAX_ROWS = 2000;

export const exportPdf = async (scope, filters, res, actor) => {
  const where = buildWhere(scope, filters);
  const dynamicColumns = await resolveDynamicColumns(filters);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 44, left: 30, right: 30 },
    bufferPages: true,
    info: { Title: 'Task Report', Author: env.APP_NAME },
  });

  doc.pipe(res);

  const totalMatching = await prisma.taskEntry.count({ where });
  const truncated = totalMatching > PDF_MAX_ROWS;

  drawHeader(doc, filters, totalMatching, truncated);

  let y = doc.y + 8;
  y = drawTableHeader(doc, y);

  let rows = 0;
  for await (const entry of streamEntries(where, PDF_MAX_ROWS)) {
    const flat = flatten(entry, dynamicColumns);

    const descHeight = doc.heightOfString(flat.description, {
      width: PDF_COLUMNS.find((c) => c.key === 'description').width - 8,
    });
    const rowHeight = Math.max(18, descHeight + 8);

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 10) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawTableHeader(doc, y);
    }

    y = drawRow(doc, flat, y, rowHeight, rows % 2 === 1);
    rows += 1;
  }

  if (rows === 0) {
    doc
      .fontSize(10)
      .fillColor('#64748B')
      .text('No task entries match the selected filters.', 30, y + 16);
  }

  drawFooters(doc);
  doc.end();

  recordExport(actor, 'PDF', rows, filters);
  return rows;
};

const drawHeader = (doc, filters, total, truncated) => {
  doc.fontSize(17).fillColor('#0F172A').font('Helvetica-Bold').text('Task Activity Report');

  const range =
    filters.dateFrom && filters.dateTo
      ? `${humanDate(filters.dateFrom)} — ${humanDate(filters.dateTo)}`
      : filters.month && filters.year
        ? dayjs(`${filters.year}-${String(filters.month).padStart(2, '0')}-01`).format('MMMM YYYY')
        : 'All dates';

  doc
    .fontSize(9)
    .fillColor('#64748B')
    .font('Helvetica')
    .text(`${range}   ·   ${total.toLocaleString()} entries   ·   Generated ${dayjs().format('DD MMM YYYY HH:mm')}`);

  if (truncated) {
    doc
      .moveDown(0.4)
      .fontSize(9)
      .fillColor('#B45309')
      .font('Helvetica-Bold')
      .text(
        `⚠ Showing the first ${PDF_MAX_ROWS.toLocaleString()} of ${total.toLocaleString()} entries. Export to Excel for the complete dataset.`,
      );
  }

  doc.moveDown(0.5);
};

const drawTableHeader = (doc, y) => {
  let x = 30;
  doc.rect(30, y, PDF_COLUMNS.reduce((s, c) => s + c.width, 0), 20).fill('#1E293B');

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF');
  for (const col of PDF_COLUMNS) {
    doc.text(col.label.toUpperCase(), x + 4, y + 6, { width: col.width - 8, lineBreak: false });
    x += col.width;
  }

  return y + 20;
};

const drawRow = (doc, flat, y, height, striped) => {
  const width = PDF_COLUMNS.reduce((s, c) => s + c.width, 0);
  if (striped) doc.rect(30, y, width, height).fill('#F8FAFC');

  let x = 30;

  for (const col of PDF_COLUMNS) {
    const value = String(flat[col.key] ?? '');
    // Amber for a late entry — never red. Red belongs to destructive actions.
    const color = col.key === 'late' && value === 'Yes' ? '#B45309' : '#0F172A';

    // Project is the column the reader is looking for; give it the only bold face.
    doc.font(col.key === 'project' ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);

    doc.fillColor(color).text(value, x + 4, y + 4, {
      width: col.width - 8,
      height: height - 6,
      ellipsis: col.key !== 'description',
    });
    x += col.width;
  }

  doc.moveTo(30, y + height).lineTo(30 + width, y + height).lineWidth(0.4).stroke('#E2E8F0');
  return y + height;
};

/** Page N of M — only computable once every page exists, hence bufferPages. */
const drawFooters = (doc) => {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .fontSize(7.5)
      .fillColor('#94A3B8')
      .font('Helvetica')
      .text(
        `${env.APP_NAME}  ·  Confidential  ·  Page ${i - range.start + 1} of ${range.count}`,
        30,
        doc.page.height - 32,
        { align: 'center', width: doc.page.width - 60, lineBreak: false },
      );
  }
};

const recordExport = (actor, format, rows, filters) => {
  audit.record({
    action: 'REPORT_EXPORTED',
    actor,
    entityType: 'Report',
    summary: `Exported ${rows.toLocaleString()} task entries as ${format}`,
    after: { format, rows, filters },
  });
  logger.info('Report exported', { format, rows, by: actor?.id });
};

/** Filename that sorts chronologically and says what it contains. */
export const buildFilename = (format, filters) => {
  const parts = ['task-report'];
  if (filters.departmentCode) parts.push(filters.departmentCode.toLowerCase());
  if (filters.dateFrom && filters.dateTo) parts.push(`${filters.dateFrom}_to_${filters.dateTo}`);
  else if (filters.year && filters.month) parts.push(`${filters.year}-${String(filters.month).padStart(2, '0')}`);
  else parts.push(dayjs().format('YYYY-MM-DD'));

  const ext = { EXCEL: 'xlsx', CSV: 'csv', PDF: 'pdf' }[format];
  if (!ext) throw new BadRequestError(`Unsupported export format: ${format}`);

  return `${parts.join('_')}.${ext}`;
};
