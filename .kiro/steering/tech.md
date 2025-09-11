---
kiro:
  include: always
  last_updated: 2025-09-11
---

# Technology Stack — Vibe Kanban (vkanban)

Architecture
- Monorepo with Rust backend and React/Vite frontend.
- Backend: Axum HTTP server nests API under `/api`, serves the SPA at `/` and `/{*path}`. SQLx + SQLite for persistence. SSE streams for live updates. Ports derive from `BACKEND_PORT`/`PORT` (defaults to auto‑assign in dev).
- Frontend: React 18 + Vite 6 + TypeScript + Tailwind. Dev server proxies `/api` to the backend port. Uses Nice Modal for dialogs and Sentry Vite plugin disabled for local telemetry by default.
- Shared types/schemas: Rust generates TypeScript types; Vite plugin exposes `virtual:executor-schemas` from `shared/schemas` to power dynamic forms.

Key Packages & Tools
- Backend crates: `crates/server` (routing, SSE, static serve), `crates/db` (SQLx, migrations), `crates/executors` (agent configs, actions, MCP), `crates/services`, `crates/deployment`, `crates/utils` (asset/temp dirs, Sentry, paths).
- Frontend deps (selected): React, @tanstack/react-query, Radix UI, Tailwind, react‑markdown, Nice Modal, CodeMirror.
- Dev tooling: `cargo-watch`, `sqlx-cli`, Playwright for E2E.

Distribution/CLI
- `npx` package publishes a cross‑platform wrapper `vkanban` (package `@kazuph/vkanban`) that extracts a prebuilt binary from `npx-cli/dist/<platform>` and runs it, enabling quick trials without cloning.

Database
- SQLite via SQLx with WAL/maintenance logic in the DB crate.
- Migrations in `crates/db/migrations` (includes 2025‑09‑02, ‑03, ‑05 and others). First start applies migrations automatically.

Runtime/Build Environment
- Node.js >= 18; pnpm >= 8 (repo includes npm scripts; pnpm lockfile present).
- Rust stable toolchain (`rust-toolchain.toml`), workspace in `Cargo.toml`.

Common Commands
- Dev (host): `pnpm i` then `pnpm run dev` (spawns backend with `cargo watch` and Vite frontend; ports auto‑assigned and stored in `.dev-ports.json`).
- Backend only (watch): `npm run backend:dev:watch`.
- Frontend only: `npm run frontend:dev` (use `FRONTEND_PORT`).
- Types generation: `npm run generate-types` / `generate-types:check`.
- Prepare SQLx: `npm run prepare-db` (runs migrations and prepares queries for SQLx).
- Docker/Compose (vkanban style): `make run` (foreground), `make start` (detached), `make logs`, `make down`, `make fix-perms`.

Ports
- Dev (default): frontend `FRONTEND_PORT` 3000, backend `BACKEND_PORT` 3001 (allocated by `scripts/setup-dev-environment.js`).
 - Docker (compose): service maps `8080:8080` with `HOST=0.0.0.0`, `PORT=8080`.
 - Dockerfile default (without compose): exposes `3000` and sets `PORT=3000` (overridden by compose).

Environment Variables (observed)
- Backend/server: `BACKEND_PORT`, `PORT`, `HOST` (bind defaults to `127.0.0.1` if unset in dev).
- Assets/config: `VIBE_KANBAN_ASSET_DIR` (absolute dir override), `VIBE_KANBAN_ASSET_MODE` (`prod|system` forces system dir), `VIBE_KANBAN_TEMP_MODE` (temp dir behavior). The server ensures the asset dir exists and seeds `profiles.json` with defaults on first run.
 - Database (dev tooling): `DATABASE_URL` used by `scripts/prepare-db.js` when running `cargo sqlx migrate/prepare` against a temporary SQLite file.
- Frontend build/dev: `FRONTEND_PORT`, `VITE_ALLOWED_HOSTS`/`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, `HMR_HOST`, `VITE_REPO_BASE` (issue/PR link base used for log/markdown linkification; default set in Dockerfile/compose to this repo).
- Docker env (compose): `GIT_CONFIG_GLOBAL=/data/gitconfig`, `VIBE_KANBAN_ASSET_DIR=${HOME}/Library/Application Support/ai.bloop.vibe-kanban`, `HOME=${HOME}` (container HOME matches host), plus `/repos/<org>/<repo>` bind.

Data & Paths
- Asset/data dir: default system location (e.g., macOS `~/Library/Application Support/ai.bloop.vibe-kanban`) or overridden via `VIBE_KANBAN_ASSET_DIR`.
- Docker binds: `./data` → `/data`, `./var_tmp_vkanban` → `/var/tmp/vibe-kanban`, host `${HOME}` → same absolute path inside container, and repo root → `/repos/<org>/<repo>`.
- Images cache under worktrees uses `.vibe-images` per `crates/utils/src/path.rs`.

Testing
- E2E via Playwright: `pnpm test:e2e` (headed/CI variants available). Playwright browsers cached to `.playwright-browsers` when running in CI‑like mode. Supports `E2E_FRONTEND_PORT` (default 3173) and `E2E_HEADLESS` (default true).

Notes & Conventions
- API base is `/api` (see `crates/server/src/routes/*`).
- SSE used for execution process/attempt streams.
- Executor settings supersede legacy “profiles”; server reads/writes `profiles.json` for backward compatibility and merges defaults.
