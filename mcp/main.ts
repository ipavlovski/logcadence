import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LogcadenceApi } from './api.ts'
import { createServer } from './server.ts'

// Entry point: Claude Desktop runs this over stdio. LOGCADENCE_PORT picks the app: 3002 Logcadence, 3003 LogcadenceDev.

const port = Number(process.env.LOGCADENCE_PORT) || 3002
await createServer(new LogcadenceApi(`http://127.0.0.1:${port}/api`)).connect(new StdioServerTransport())
