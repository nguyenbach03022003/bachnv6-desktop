import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectDir, 'src', 'mascot-renderer'),
  plugins: [react()],
  build: {
    outDir: path.join(projectDir, '.vite', 'renderer', 'mascot_window'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
