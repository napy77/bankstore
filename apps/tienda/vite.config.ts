import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // En producción Nginx sirve los estáticos y proxea /api al backend desde
    // el mismo origen. El proxy de dev replica eso: así el código nunca sabe
    // en cuál de los dos está, y no hay CORS en ninguno.
    proxy: {
      '/api': { target: 'http://localhost:4020', changeOrigin: true },
    },
  },
});
