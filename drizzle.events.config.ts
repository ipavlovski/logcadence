import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/events-schema.ts',
  out: './server/db/migrations/events',
  dbCredentials: { url: './data/db/events.db' },
})
