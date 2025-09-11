---
kiro:
  include: always
  last_updated: 2025-09-11
---

# Project Structure — Vibe Kanban (vkanban)

Root Layout (key items)
- `Cargo.toml` — Rust workspace manifest.
- `crates/` — backend crates (server, db, executors, services, deployment, utils).
- `frontend/` — React + Vite app (TS), Tailwind, Radix UI.
- `npx-cli/` — cross‑platform CLI wrapper (`vkanban`) distributing prebuilt binaries per platform.
- `shared/` — generated types (`types.ts`) and JSON schemas consumed by the frontend via `virtual:executor-schemas`.
- `assets/` — static assets (sounds, scripts) embedded by backend utils.
- `scripts/` — dev helpers (port allocation, SQLx prepare, etc.).
- `dev_assets_seed/` & `dev_assets/` — local dev DB/config seeds (copied/created by scripts).
- `compose.yml`, `Dockerfile`, `Makefile` — Docker/Compose workflows kept in vkanban style.
- `data/`, `var_tmp_vkanban/` — local runtime data and temp/worktrees (git‑ignored).
- `tests/e2e/` — Playwright end‑to‑end tests; `playwright.config.ts` controls dev server startup and ports.

Backend Crates
- `crates/server` — Axum app; routes under `/api` and SPA file serving.
  - `routes/` includes: `projects.rs`, `tasks.rs`, `task_attempts.rs`, `execution_processes.rs` (SSE), `config.rs`, `images.rs`, `filesystem.rs`, `auth.rs`, `health.rs`.
  - `src/main.rs` binds to `HOST`/`PORT` or auto‑assigns a free port; opens browser in non‑debug builds; writes a port file in production.
- `crates/db` — SQLx models and migrations in `migrations/` (numerous, including 2025‑09‑02/03/05 updates).
- `crates/executors` — executor definitions/configs (successor to “profiles”), actions, logging utilities, MCP support, default profiles JSON.
- `crates/services` — background services (e.g., monitors, processors) used by deployment/server.
- `crates/deployment` — deployment glue and app state management.
- `crates/utils` — asset dir resolution, temp dir logic, path utilities, Sentry integration, port file helpers.

Frontend
- `frontend/vite.config.ts` — Vite plugins: React, Sentry (telemetry off in local), `executor-schemas` virtual module; dev server proxy `/api → backend` with dynamic ports; allowedHosts + HMR host control.
- `frontend/src/` —
  - `pages/` (Projects, ProjectTasks, Settings) — route‑level screens.
  - `components/` — UI (logs, tasks, diff, dialogs), executor config forms, shadcn/ui.
  - `contexts/`, `hooks/`, `lib/` — client API, state, helpers.
  - `styles/`, `types/` — Tailwind setup and local type helpers.

Code Organization Patterns
- API requests originate from frontend `lib/api` and route components; backend nests all JSON endpoints under `/api`.
- Realtime flows use SSE endpoints in `execution_processes.rs` and related routes.
- Shared TS types are generated from Rust and imported from `shared/types.ts`.
- Executor config UIs import schemas via `virtual:executor-schemas` (built at runtime from `shared/schemas/*.json`).

Naming Conventions
- TypeScript/React files use PascalCase for components and kebab/camel case for file names as appropriate; avoid long relative paths via `@` and `shared` aliases.
- Rust follows standard crate/module organization; migrations use timestamped filenames.

Import Organization
- Frontend aliases: `@ → frontend/src`, `shared → shared/`.
- Server modules grouped by feature under `crates/server/src/routes` and merged into the root router.

Operational Directories
- Asset/data dir: system app‑support location by default (overridable via `VIBE_KANBAN_ASSET_DIR`).
- Docker binds: `./data ↔ /data`, `./var_tmp_vkanban ↔ /var/tmp/vibe-kanban`, host `${HOME} ↔ ${HOME}`, repo root ↔ `/repos/<org>/<repo>`.

Architectural Principles
- Keep dev fast: separate Vite dev server with proxy; backend hot‑reload via `cargo-watch`.
- Single source of truth: generated types and centralized executor config.
- Additive migrations and backward‑compatible config (profiles → executors) to avoid breaking users.
