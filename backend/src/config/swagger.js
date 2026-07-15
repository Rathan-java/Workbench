/**
 * OpenAPI documentation.
 *
 * Generated from the @openapi JSDoc blocks that live next to the routes they
 * describe. A spec kept in a separate file drifts from the code within one
 * sprint; a spec written three lines above the handler does not.
 *
 * Disabled by default in production via SWAGGER_ENABLED — a public, complete map
 * of every endpoint and every parameter is free reconnaissance. Turn it on
 * deliberately, behind the corporate network.
 */
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { env } from './env.js';
import { logger } from './logger.js';

const definition = {
  openapi: '3.0.3',
  info: {
    title: `${env.APP_NAME} API`,
    version: '1.0.0',
    description: `
# Enterprise Task Monitoring System

Hourly task logging, approval workflow and productivity analytics across four
independently-isolated departments.

## The access model — read this first

Authorisation has **two independent layers**, and a request must pass both.

| Layer | Question it answers | Where it lives |
|---|---|---|
| **Permission** | May this role do this *kind* of thing at all? | \`authorize(PERMISSIONS.TASK_APPROVE)\` on the route |
| **Scope** | May they do it to *these rows*? | \`scopeWhere(scope)\` inside every repository query |

Scopes resolve from the caller's role:

- **MANAGEMENT** → \`GLOBAL\`. Every department, every team, every employee.
- **TECH_LEAD** → \`DEPARTMENT\`. Their own department only — every query they
  make is silently constrained to it. There is no parameter that widens this.
- **EMPLOYEE** → \`SELF\`. Their own task data only.

Departmental isolation is not a check that can be forgotten; it is a mandatory
\`WHERE\` clause compiled into every scoped query. A Video Editing lead cannot
read a Digital Marketing timesheet through any code path in this API.

## Sessions

\`POST /auth/login\` returns a **15-minute access token** in the body and sets a
**rotating refresh token** in an \`httpOnly; Secure; SameSite=Strict\` cookie.

Send the access token as \`Authorization: Bearer <token>\`. When it expires, call
\`POST /auth/refresh\` — the cookie goes automatically.

Refresh tokens **rotate on every use** and are tracked as a family. Replaying an
already-rotated token is treated as theft: the entire family is revoked and the
user is forced to sign in again.

## Response envelope

Every response, success or failure, has the same shape.

\`\`\`json
{ "success": true, "data": {}, "meta": {}, "correlationId": "…", "timestamp": "…" }
{ "success": false, "error": { "code": "…", "message": "…", "details": {} }, "correlationId": "…" }
\`\`\`

The \`correlationId\` also comes back in the \`x-correlation-id\` header and appears
on every log line and audit row for that request.
`,
    contact: { name: 'Platform Engineering' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: `http://localhost:${env.PORT}${env.API_PREFIX}`, description: 'Local' },
    { url: `${env.CLIENT_URL}${env.API_PREFIX}`, description: 'Deployed' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'The 15-minute access token from POST /auth/login.',
      },
    },
    schemas: {
      ApiSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: {},
          meta: { type: 'object' },
          correlationId: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'FORBIDDEN' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
          correlationId: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          pageSize: { type: 'integer', example: 25 },
          total: { type: 'integer', example: 137 },
          totalPages: { type: 'integer', example: 6 },
          hasNextPage: { type: 'boolean' },
          hasPreviousPage: { type: 'boolean' },
        },
      },
      TaskEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          timeSlotId: { type: 'string' },
          description: {
            type: 'string',
            description:
              'WHAT WAS COMPLETED in this hour. An entry is a record of work already done — there is no status field, because every entry is finished work by definition.',
            example: 'Built the payment reconciliation service and its regression suite',
          },
          projectId: {
            type: 'string',
            description:
              'REQUIRED. What the hour was completed FOR, and the index that lets progress roll up by project as well as by person and department. Every department has an "Internal / Non-project" project for hours that genuinely belong to none.',
          },
          remarks: { type: 'string', nullable: true },
          attributes: {
            type: 'object',
            nullable: true,
            description:
              'Optional department-specific fields, validated against that department’s TaskFieldDefinition rows. No definitions are seeded — this is an extension point, not a default. The out-of-the-box form asks for a description and a project, and nothing else.',
          },
          version: {
            type: 'integer',
            description:
              'Optimistic-concurrency token. Echo this on your next write; a stale value returns 409 instead of silently overwriting a colleague’s edit.',
          },
          isLate: {
            type: 'boolean',
            description: 'Saved after its hour had already elapsed. Computed server-side only.',
          },
          editedByLead: { type: 'boolean' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Not signed in, or the access token has expired.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
      Forbidden: {
        description:
          'Signed in, but lacking either the permission or the scope. A Tech Lead receives this when reaching for another department’s data.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
      NotFound: {
        description: 'No such record.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
      ValidationError: {
        description: 'The request body failed validation. `details.issues` is field-by-field.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
      RateLimited: {
        description: 'Too many requests.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
      PaginatedList: {
        description: 'A page of results. `meta.pagination` carries the cursor state.',
        content: {
          'application/json': {
            schema: {
              allOf: [
                { $ref: '#/components/schemas/ApiSuccess' },
                {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: {} },
                    meta: {
                      type: 'object',
                      properties: { pagination: { $ref: '#/components/schemas/Pagination' } },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
  // Applied to every operation unless overridden with `security: []`.
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Authentication' },
    { name: 'Tasks' },
    { name: 'Dashboard' },
    { name: 'Users' },
    { name: 'Teams' },
    { name: 'Projects' },
    { name: 'Departments' },
    { name: 'Reports' },
    { name: 'Notifications' },
    { name: 'Audit' },
    { name: 'Settings' },
    { name: 'System' },
  ],
};

export const buildSwaggerSpec = () =>
  swaggerJsdoc({
    definition,
    apis: ['./src/modules/**/*.routes.js', './src/routes/*.js'],
  });

export const mountSwagger = (app) => {
  if (!env.SWAGGER_ENABLED) {
    logger.info('Swagger is disabled (SWAGGER_ENABLED=false)');
    return;
  }

  const spec = buildSwaggerSpec();

  app.get('/api-docs.json', (_req, res) => res.json(spec));

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: `${env.APP_NAME} API`,
      swaggerOptions: {
        persistAuthorization: true, // survives a page reload while you are testing
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
      },
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info .title { font-size: 30px; letter-spacing: -0.5px }
        .swagger-ui .scheme-container { box-shadow: none; border-bottom: 1px solid #e2e8f0 }
      `,
    }),
  );

  logger.info(`Swagger UI mounted at http://localhost:${env.PORT}/api-docs`);
};
