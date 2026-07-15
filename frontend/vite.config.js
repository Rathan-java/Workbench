import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The refresh token lives in an httpOnly cookie. Proxying through the dev
      // origin keeps it same-site, so no CORS/SameSite juggling in development.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Avatars. The API serves these from /uploads and requires authentication
      // for them — an employee's photo is personal data, not a public URL. Without
      // this proxy entry every avatar 404s in development, because Vite would try
      // to resolve /uploads/... against the SPA's own static assets.
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'axios', '@tanstack/react-query'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          charts: ['recharts'],
        },
      },
    },
  },
});
