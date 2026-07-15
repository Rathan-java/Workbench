import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import * as service from './report.service.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { exportLimiter } from '../../middleware/rateLimit.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';

const router = Router();
router.use(authenticate);

const exportQuery = z.object({
  format: z.enum(['EXCEL', 'CSV', 'PDF']).default('EXCEL'),
  departmentId: z.string().cuid().optional(),
  departmentCode: z.string().max(48).optional(),
  teamId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  isLate: queryBoolean(),
});

const CONTENT_TYPES = {
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv; charset=utf-8',
  PDF: 'application/pdf',
};

/**
 * @openapi
 * tags:
 *   name: Reports
 *   description: |
 *     Excel, CSV and PDF exports. All three are streamed — a 20,000-row export
 *     never exists in memory as a whole — and all three are scoped and audited.
 */

/**
 * @openapi
 * /reports/tasks/export:
 *   get:
 *     tags: [Reports]
 *     summary: Export task entries
 *     description: |
 *       Honours every filter the monitoring screen offers, applies the caller's
 *       access scope (a Tech Lead's export contains only their department), and
 *       writes an audit record — exporting data is an event a compliance officer
 *       will one day want to see.
 *
 *       Pass `projectId` to narrow the file to a single project — that is the
 *       axis the work is managed along, and the one people ask exports for.
 *
 *       CSV output is escaped against formula injection: a task description
 *       beginning with `=` is neutralised, because Excel would otherwise execute
 *       it when the manager opens the file.
 *     parameters:
 *       - { in: query, name: format, schema: { type: string, enum: [EXCEL, CSV, PDF] } }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *       - { in: query, name: teamId, schema: { type: string } }
 *       - { in: query, name: userId, schema: { type: string } }
 *       - { in: query, name: projectId, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *       - { in: query, name: isLate, schema: { type: boolean } }
 *     responses:
 *       200:
 *         description: The report file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet: {}
 *           text/csv: {}
 *           application/pdf: {}
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.get(
  '/tasks/export',
  exportLimiter,
  authorize(PERMISSIONS.REPORT_EXPORT),
  validate({ query: exportQuery }),
  asyncHandler(async (req, res) => {
    const { format, ...filters } = req.query;
    const filename = service.buildFilename(format, filters);

    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Tell the browser not to sniff, and never cache a report containing
    // employee data in an intermediary.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const exporters = {
      EXCEL: service.exportExcel,
      CSV: service.exportCsv,
      PDF: service.exportPdf,
    };

    await exporters[format](req.scope, filters, res, req.user);
    // Deliberately no ApiResponse envelope here: the response body IS the file.
    // The stream is closed by the exporter.
  }),
);

export default router;
