import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/studio': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/render': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/generate': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/templates': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/studio',
  },
})
