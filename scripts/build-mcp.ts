// Builds the Logcadence MCP server (mcp/) as a Claude Desktop extension: release/logcadence.mcpb.
// Usage: tsx scripts/build-mcp.ts
//
// The server is bundled with its packages into one file, since Claude Desktop runs it with its own Node and
// nothing installed. The manifest gets the app's version; `mcpb pack` validates it and zips the folder.

import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const STAGE = 'release/mcpb'
const OUT = 'release/logcadence.mcpb'
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })
await build({ entryPoints: ['mcp/main.ts'], outfile: `${STAGE}/server/index.mjs`, bundle: true, platform: 'node', target: 'node20', format: 'esm', logLevel: 'info' })
const manifest = JSON.parse(readFileSync('mcp/manifest.json', 'utf8')) as { version: string }
writeFileSync(`${STAGE}/manifest.json`, JSON.stringify({ ...manifest, version }, null, 2))
execFileSync('node_modules/.bin/mcpb', ['pack', STAGE, OUT], { stdio: 'inherit' })
