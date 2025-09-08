import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Upstream: virtual module to load executor schemas (kept)
function executorSchemasPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:executor-schemas";
  const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
  return {
    name: "executor-schemas-plugin",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;
      const schemasDir = path.resolve(__dirname, "../shared/schemas");
      const files = fs.existsSync(schemasDir)
        ? fs.readdirSync(schemasDir).filter((f) => f.endsWith(".json"))
        : [];
      const imports: string[] = [];
      const entries: string[] = [];
      files.forEach((file, i) => {
        const varName = `__schema_${i}`;
        const importPath = `shared/schemas/${file}`;
        const key = file.replace(/\.json$/, "").toUpperCase();
        imports.push(`import ${varName} from "${importPath}";`);
        entries.push(`  "${key}": ${varName}`);
      });
      const code = `
${imports.join("\n")}

export const schemas = {
${entries.join(",\n")}
};

export default schemas;
`;
      return code;
    },
  };
}

function getBackendPort(): number {
  const envPort = process.env.BACKEND_PORT;
  if (envPort && /^\d+$/.test(envPort.trim())) return parseInt(envPort.trim(), 10);
  try {
    const portsPath = path.resolve(__dirname, '..', '.dev-ports.json');
    if (fs.existsSync(portsPath)) {
      const data = JSON.parse(fs.readFileSync(portsPath, 'utf-8'));
      if (typeof data.backend === 'number') return data.backend;
      if (typeof data.backend === 'string' && /^\d+$/.test(data.backend)) return parseInt(data.backend, 10);
    }
  } catch (_) {}
  return 3001;
}

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({ org: "bloop-ai", project: "vibe-kanban" }),
    executorSchemasPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    host: true,
    port: parseInt(process.env.FRONTEND_PORT || '3000'),
    allowedHosts: (() => {
      const envList = process.env.VITE_ALLOWED_HOSTS || process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS;
      if (envList && envList.trim()) {
        return envList.split(',').map((s) => s.trim()).filter(Boolean);
      }
      const hostLower = os.hostname().toLowerCase();
      const baseHost = hostLower.replace(/\.local$/, '');
      const defaults = new Set<string>(['.ts.net', baseHost, `${baseHost}.local`, 'localhost']);
      return Array.from(defaults);
    })(),
    hmr: (() => {
      const base = { protocol: 'ws', clientPort: parseInt(process.env.FRONTEND_PORT || '3000') } as const;
      const h = process.env.HMR_HOST?.trim();
      return h ? { ...base, host: h } : base;
    })(),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${getBackendPort()}`,
        changeOrigin: true,
        router: () => `http://127.0.0.1:${getBackendPort()}`,
        configure: (proxy) => { proxy.on('error', () => {}); },
      },
    },
    fs: {
      allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "..")],
    },
  },
  preview: { host: true },
  build: { sourcemap: true },
})
