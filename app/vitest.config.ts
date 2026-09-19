import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Default env is node (for electron/cli tests). Renderer component tests opt
// into jsdom with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Node's --localstorage-file backs localStorage with one file shared by every
    // worker, so parallel files clobber each other's keys via the afterEach clear
    // in setup.ts. Run files sequentially to keep localStorage isolated per file.
    fileParallelism: false,
    env: { CODEBURN_APP_FILTER: '' },
    globals: false,
    setupFiles: ['./renderer/test/setup.ts'],
    include: ['renderer/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
