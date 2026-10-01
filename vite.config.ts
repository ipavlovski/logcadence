import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // /assets is where the server serves pasted media.
  build: { assetsDir: 'static' },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3002',
      '/assets': 'http://127.0.0.1:3002',
    },
  },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
} as any)
