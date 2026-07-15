/**
 * One place that knows how to turn a first/last name into a display name.
 *
 * lastName is optional (a person may have a single legal name), and the naive
 * `${firstName} ${lastName}` betrays that immediately: template literals coerce
 * null to the string "null", so a mononymous employee renders as "Arjun null"
 * in every report, email and audit line. This joins only the parts that exist.
 *
 * @param {{ firstName?: string|null, lastName?: string|null }} person
 * @returns {string}
 */
export const fullName = (person) =>
  [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim();
