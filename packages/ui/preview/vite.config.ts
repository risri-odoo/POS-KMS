import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-only component gallery. Run with: pnpm --filter @stayx/ui run preview:ui
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true },
});
