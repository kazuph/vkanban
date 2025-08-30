import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

function getBackendPort(): number {
  // Prefer explicit env var
  const envPort = process.env.BACKEND_PORT;
  if (envPort && /^\d+$/.test(envPort.trim())) return parseInt(envPort.trim(), 10);
  // Fallback: read from repo-level .dev-ports.json if present (used by npm run dev)
  try {
    const portsPath = path.resolve(__dirname, '..', '.dev-ports.json');
    if (fs.existsSync(portsPath)) {
      const data = JSON.parse(fs.readFileSync(portsPath, 'utf-8'));
      if (typeof data.backend === 'number') return data.backend;
      if (typeof data.backend === 'string' && /^\d+$/.test(data.backend)) return parseInt(data.backend, 10);
    }
  } catch (_) {
    // ignore and fallback
  }
  return 3001;
}

export default defineConfig({
  plugins: [react(), sentryVitePlugin({
    org: "bloop-ai",
    project: "vibe-kanban"
  })],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "shared": path.resolve(__dirname, "../shared"),
    },
  },

  server: {
    port: parseInt(process.env.FRONTEND_PORT || '3000'),
    // Make HMR explicit to avoid IPv6/host inference issues
    hmr: {
      host: 'localhost',
      protocol: 'ws',
      clientPort: parseInt(process.env.FRONTEND_PORT || '3000'),
    },
    proxy: {
      '/api': {
        // Use 127.0.0.1 to avoid IPv6 (::1) resolution mismatches with backend binding
        target: `http://127.0.0.1:${getBackendPort()}`,
        changeOrigin: true,
        // Dynamically re-read backend port to survive restarts/port changes
        router: () => `http://127.0.0.1:${getBackendPort()}`,
        // During backend restarts, proxy will emit noisy ECONNREFUSED logs.
        // Quiet them in dev to avoid terminal spam.
        configure: (proxy) => {
          proxy.on('error', () => {
            // swallow proxy errors; the frontend has its own lightweight retry
          });
        },
      },
    },
  },

  build: {
    sourcemap: true
  }
})
