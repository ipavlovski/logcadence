import { importFrom } from '../server/lib/transfer/import.ts'

// Runs a data import in an Electron utility process: importFrom is synchronous and a full library is many GB,
// so it stays off the main process (which keeps the window responsive and reports progress).

interface Job {
  zip: string
  dataDir: string
}

process.parentPort.once('message', ({ data }: { data: Job }) => {
  try {
    const { warnings } = importFrom(data.zip, {
      dataDir: data.dataDir,
      onProgress: (progress) => process.parentPort.postMessage({ type: 'progress', progress }),
    })
    process.parentPort.postMessage({ type: 'done', warnings })
  } catch (err) {
    process.parentPort.postMessage({ type: 'error', message: (err as Error).message })
  }
  process.exit(0)
})
