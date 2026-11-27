import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from '@stayx/web-common/csp';

export default defineConfig({
  // cspPlugin: strict Content-Security-Policy in the built page only (INTEGRATION_DESIGN.md §8.6).
  plugins: [react(), tailwindcss(), cspPlugin({ apiUrl: 'http://localhost:4000/api/v1' })],
  server: {
    port: 5180,
    strictPort: true,
    // Listen on the LAN so a staff tablet on the same Wi-Fi can open it.
    host: true,
  },
});
