import { defineConfig } from 'vite'
import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'path'

export default defineConfig(() => ({
  server: {
    host: '::',
    port: 8080,
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '~/': resolve(__dirname, './server'),
    },
  },
  // Configure for Nitro-like server handling
  optimizeDeps: {
    exclude: ['@dyad-sh/react-vite-component-tagger'],
  },
}))