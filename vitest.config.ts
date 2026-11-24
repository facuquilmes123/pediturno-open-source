
/// <reference types="vitest" />

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'forks',
    maxWorkers: 2,
    setupFiles: './src/tests/setup.ts',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/tests/server-only.ts'),
    },
    mockReset: true,
    exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        'tests/**', // Exclude Playwright tests
        // Emulator suites require FIRESTORE_EMULATOR_HOST and are invoked via
        // firebase emulators:exec, never by the ordinary unit-test command.
        ...(process.env.FIRESTORE_EMULATOR_HOST ? [] : ['**/*.emulator.test.ts'])
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/tests/server-only.ts'),
    },
  },
})
