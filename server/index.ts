import path from 'node:path'
import { ROOT } from './db/client.ts'
import { startServer } from './start.ts'

const running = await startServer({
  port: Number(process.env.PORT ?? 3002),
  staticDir: process.env.NODE_ENV === 'production' ? path.join(ROOT, 'dist') : undefined,
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => running.stop().then(() => process.exit(0)))
