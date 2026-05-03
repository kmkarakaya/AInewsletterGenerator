import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const appPort = parsePort(process.env.PORT || env.PORT, 3005);
  const hmrPort = parsePort(process.env.HMR_PORT || env.HMR_PORT, appPort + 1);
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : {
            port: hmrPort,
            clientPort: hmrPort,
          },
    },
  };
});
