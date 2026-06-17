import { defineConfig } from 'vitest/config'

// Unit tests for pure modules (no Electron). Scoped to *.test.ts under src.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
