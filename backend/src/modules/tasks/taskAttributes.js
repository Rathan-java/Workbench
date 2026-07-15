/**
 * DEPARTMENT-DRIVEN TASK FIELD VALIDATION.
 *
 * This file is what makes "four departments, four different task entry forms"
 * work without four codebases.
 *
 * Each department owns a set of TaskFieldDefinition rows. At request time we
 * compile those rows into a Zod schema and validate TaskEntry.attributes against
 * it. The frontend renders its inputs from the same rows. One source of truth,
 * in the database, driving both sides.
 *
 * WHY NOT just trust the JSON column?
 *   An unvalidated JSON column is a schemaless dumping ground. Within six months
 *   you have `platform: "Instagram"`, `platform: "instagram"`, `platform: 4` and
 *   `platfrom: "IG"` — and every report that groups by platform is a lie. The
 *   JSON gives us flexibility; the compiled schema gives us the integrity we
 *   gave up by leaving the relational model.
 *
 * WHY THE CACHE?
 *   Field definitions change roughly never, and this runs on the hot path of
 *   every auto-save. Rebuilding four Zod schemas per keystroke would be absurd.
 *   The cache is invalidated explicitly whenever a definition is written.
 */
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { FIELD_TYPE } from '../../config/constants.js';
import { ValidationError } from '../../core/errors.js';

/** @type {Map<string, {schema: import('zod').ZodTypeAny, fields: object[], builtAt: number}>} */
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Turn ONE field definition into a Zod validator. */
const compileField = (field) => {
  /** @type {import('zod').ZodTypeAny} */
  let schema;

  switch (field.type) {
    case FIELD_TYPE.TEXT:
      schema = z.string().trim().max(field.maxLength ?? 255);
      break;

    case FIELD_TYPE.TEXTAREA:
      schema = z.string().trim().max(field.maxLength ?? 2000);
      break;

    case FIELD_TYPE.URL:
      schema = z.string().trim().url('Enter a valid URL').max(500);
      break;

    case FIELD_TYPE.NUMBER:
      schema = z.coerce.number();
      if (field.minValue != null) schema = schema.min(field.minValue);
      if (field.maxValue != null) schema = schema.max(field.maxValue);
      break;

    case FIELD_TYPE.DURATION_MINUTES:
      schema = z.coerce
        .number()
        .int('Enter a whole number of minutes')
        .min(field.minValue ?? 0)
        .max(field.maxValue ?? 1440);
      break;

    case FIELD_TYPE.BOOLEAN:
      schema = z.coerce.boolean();
      break;

    case FIELD_TYPE.DATE:
      schema = z.string().date('Enter a valid date (YYYY-MM-DD)');
      break;

    case FIELD_TYPE.SELECT: {
      const options = Array.isArray(field.options) ? field.options.map(String) : [];
      // A SELECT with no options would compile to z.never() and silently reject
      // everything. Fall back to a plain string and shout — this is a config bug.
      if (!options.length) {
        logger.warn('SELECT field has no options; falling back to free text', {
          key: field.key,
          departmentId: field.departmentId,
        });
        schema = z.string().trim().max(255);
      } else {
        schema = z.enum(/** @type {[string, ...string[]]} */ (options), {
          errorMap: () => ({ message: `Must be one of: ${options.join(', ')}` }),
        });
      }
      break;
    }

    case FIELD_TYPE.MULTISELECT: {
      const options = Array.isArray(field.options) ? field.options.map(String) : [];
      const item = options.length
        ? z.enum(/** @type {[string, ...string[]]} */ (options))
        : z.string().trim().max(255);
      schema = z.array(item).max(20);
      break;
    }

    default:
      logger.warn('Unknown task field type; treating as text', { type: field.type, key: field.key });
      schema = z.string().trim().max(255);
  }

  // Optional fields accept null/undefined/'' — an employee mid-typing has an
  // empty box, and auto-save must not reject that.
  if (!field.isRequired) {
    schema = schema.optional().nullable().or(z.literal(''));
  } else if (field.type === FIELD_TYPE.TEXT || field.type === FIELD_TYPE.TEXTAREA) {
    schema = schema.min(1, `${field.label} is required`);
  }

  return schema;
};

const buildSchema = (fields) => {
  const shape = Object.fromEntries(fields.map((f) => [f.key, compileField(f)]));
  // `.strict()` — an unknown key is rejected, not silently stored. A typo'd key
  // that quietly persists is worse than an error: it looks like it worked.
  return z.object(shape).strict();
};

/**
 * Get (and cache) the compiled attribute schema for a department.
 * @param {string} departmentId
 */
export const getAttributeSchema = async (departmentId) => {
  const hit = cache.get(departmentId);
  if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) return hit;

  const fields = await prisma.taskFieldDefinition.findMany({
    where: { departmentId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  const entry = { schema: buildSchema(fields), fields, builtAt: Date.now() };
  cache.set(departmentId, entry);

  logger.debug('Compiled task attribute schema', { departmentId, fieldCount: fields.length });
  return entry;
};

/** Called whenever a TaskFieldDefinition is written. */
export const invalidateAttributeSchema = (departmentId) => {
  if (departmentId) cache.delete(departmentId);
  else cache.clear();
};

/**
 * Validate an attributes payload for a department.
 *
 * @param {string} departmentId
 * @param {object|null|undefined} attributes
 * @param {{partial?: boolean}} [options] `partial: true` for auto-save, where a
 *   half-filled form is expected and required-field errors would be noise. The
 *   full check runs on submit.
 * @returns {Promise<object|null>}
 */
export const validateAttributes = async (departmentId, attributes, { partial = false } = {}) => {
  const { schema, fields } = await getAttributeSchema(departmentId);

  // Nothing sent, nothing to check. This is now the overwhelmingly common case:
  // no department seeds any custom fields, so the shipped form sends no
  // attributes at all.
  if (attributes == null || Object.keys(attributes).length === 0) return null;

  // Something WAS sent. Validate it strictly, even when the department defines no
  // fields — ESPECIALLY then.
  //
  // This used to `return null` the moment a department had no field definitions,
  // which was harmless when every department seeded four or five. Now that zero
  // is the default, that shortcut would mean an unknown key is accepted with a
  // 200 and then thrown away: the client is told its data was saved, and it was
  // not. A schema that silently discards what it does not recognise is worse than
  // no schema, because it teaches the caller to trust a lie.
  //
  // An empty department therefore compiles to `z.object({}).strict()`, and ANY
  // key at all is a 422. Which is correct: there is nowhere for it to go.
  if (!fields.length && !partial) {
    throw new ValidationError(
      Object.keys(attributes).map((key) => ({
        path: `attributes.${key}`,
        message: 'This department has no custom fields. Remove it, or define the field first.',
      })),
      'Some department-specific fields are invalid',
    );
  }

  const effective = partial ? schema.partial() : schema;
  const result = effective.safeParse(attributes ?? {});

  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({
        path: `attributes.${i.path.join('.')}`,
        message: i.message,
      })),
      'Some department-specific fields are invalid',
    );
  }

  // Strip empty strings so the stored JSON holds real values or nothing —
  // `{ campaign: "" }` and `{}` must not be two different states in a report.
  const cleaned = Object.fromEntries(
    Object.entries(result.data).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );

  return Object.keys(cleaned).length ? cleaned : null;
};

/** Field definitions flagged for the list/report views of a department. */
export const getTableColumns = async (departmentId) => {
  const { fields } = await getAttributeSchema(departmentId);
  return fields.filter((f) => f.showInTable);
};
