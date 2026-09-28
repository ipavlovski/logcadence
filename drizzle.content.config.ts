import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/content-schema.ts',
  out: './server/db/migrations/content',
  dbCredentials: { url: './data/db/content.db' },
})
