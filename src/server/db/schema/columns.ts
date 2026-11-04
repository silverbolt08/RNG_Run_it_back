import { text } from 'drizzle-orm/sqlite-core';

/** UTC ISO 8601 strings, from the system clock rather than the business date. */
export const timestamps = () => ({
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
