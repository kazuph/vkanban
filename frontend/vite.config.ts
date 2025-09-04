// vite.config.ts
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import os from "os";

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

function executorSchemasPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:executor-schemas";
  const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

  return {
    name: "executor-schemas-plugin",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID; // keep it virtual
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
        const importPath = `shared/schemas/${file}`; // uses your alias
        const key = file.replace(/\.json$/, "").toUpperCase(); // claude_code -> CLAUDE_CODE
        imports.push(`import ${varName} from "${importPath}";`);
        entries.push(`  "${key}": ${varName}`);
      });

      // IMPORTANT: pure JS (no TS types), and quote keys.
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

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({ org: "bloop-ai", project: "vibe-kanban" }),
    executorSchemasPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      shared: path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    // Bind to all interfaces so external hosts can access dev server
    host: true,
    port: parseInt(process.env.FRONTEND_PORT || "3000"),
    // Allow access via Tailscale and other non-localhost hosts.
    // Security note: keep this list tight for dev convenience; expand via env when needed.
    // Docs: https://vite.dev/config/server-options#server-allowedhosts
    allowedHosts: (() => {
      // Prefer explicit env configuration: comma separated hostnames or patterns (e.g. ".ts.net")
      const envList =
        process.env.VITE_ALLOWED_HOSTS ||
        process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS;
      if (envList && envList.trim()) {
        return envList
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      // Default: allow local machine hostname and .local, plus Tailscale MagicDNS.
      const hostLower = os.hostname().toLowerCase();
      const baseHost = hostLower.replace(/\.local$/, '');
      const defaults = new Set<string>([
        '.ts.net',           // Tailscale MagicDNS
        baseHost,            // e.g. "macbook-air"
        `${baseHost}.local`, // e.g. "macbook-air.local"
        'localhost',
      ]);
      return Array.from(defaults);
    })(),
    // Make HMR explicit to avoid IPv6/host inference issues
    // Do NOT hardcode host to 'localhost' — let the client use window.location.hostname.
    hmr: (() => {
      const base = {
        protocol: 'ws',
        clientPort: parseInt(process.env.FRONTEND_PORT || "3000"),
      } as const;
      const h = process.env.HMR_HOST?.trim();
      return h ? { ...base, host: h } : base;
    })(),
    proxy: {
      "/api": {
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
    fs: {
      allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "..")],
    },
  },

  // Ensure `vite preview` is also reachable from external hosts
  preview: {
    host: true,
  },

  build: { sourcemap: true },
});