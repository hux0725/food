import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // API tests start real Fastify instances with their own temp databases; keep them isolated per file.
    pool: 'forks',
    reporters: ['default'],
  },
})
