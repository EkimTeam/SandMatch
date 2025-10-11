import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/sm-admin': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    outDir: '../static/frontend',
    emptyOutDir: true,
    assetsDir: 'assets',
    manifest: true,
    // Base public path for assets in production
    // Django will serve them under /static/frontend/
    // and read manifest.json to get hashed filenames
    rollupOptions: {
      input: '/src/main.tsx',
    },
  }
})
