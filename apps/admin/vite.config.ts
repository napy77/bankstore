import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo la API corre en otro puerto. El proxy la deja en el mismo
    // origen que el panel, igual que en producción: así no hay CORS ni en dev
    // ni en prod, y el código no necesita saber en cuál está.
    proxy: {
      '/api': { target: 'http://localhost:4020', changeOrigin: true },
    },
  },
});
