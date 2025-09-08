# AGENTS Runbook

このリポジトリの運用ノウハウ（簡潔版）。

## Docker/Compose

- 起動: `make run`
- ログ: `make logs`
- 停止: `make down`
- 権限修復: `make fix-perms`（`./data` と `./var_tmp_vkanban` の所有権整備）
- 最悪時復旧: `make run-root` → Ctrl-C → `make fix-perms` → `make run`

### マウント/永続ディレクトリ
- `/data` ↔ `./data`（アセット、DB、設定、画像キャッシュ）
- `/var/tmp/vibe-kanban` ↔ `./var_tmp_vkanban`（ワークツリー/一時ファイル）
- `/repos/<org>/<repo>` ↔ `現在の Git リポジトリ`（pnpm dev と同じプロジェクトを参照）

  - `make run`/`make start` は、実行中の repo を自動的に `/repos/<org>/<repo>` にマウントします。
  - 自動検出: `REPO_ABS_PATH` は `git rev-parse --show-toplevel`、`REPO_CANON` は `git remote origin` から `<org>/<repo>` を推定。
  - 明示指定も可能: `REPO_ABS_PATH=/path/to/project REPO_CANON=myorg/myrepo make run`

### よくある問題と対処
- PermissionDenied で起動失敗: `./data` 配下のファイルが root 所有。
  - 対処: `make fix-perms` または `sudo chown -R $(id -u):$(id -g) data var_tmp_vkanban`
  - 再生成: `rm -f data/config.json data/profiles.json data/db.sqlite*` 後に `make run`
- 画像キャッシュ書き込みエラー: `/data/images` が書き込み不可。
  - エントリポイントで自動作成＆診断出力あり。所有権を修復して再起動。
- コンテナ内でブラウザが開けない警告: 仕様上問題なし。`http://127.0.0.1:8080` を手動で開く。

### デバッグ Tips
- 详细ログ: `RUST_LOG=debug UID=$(id -u) GID=$(id -g) docker compose up`
- コンテナ内の状態確認: `docker compose exec vkanban sh -lc 'id && ls -la /data && ls -ld /var/tmp/vibe-kanban'`

### 補足
- コンテナはホストの `${UID}:${GID}` で動作。`./data` は常に自ユーザー所有に維持。
- Rust のビルドが重いため、通常は `--no-cache` を使わない。
- ローカル実行用のディレクトリは Git 追跡外: `data/`, `var_tmp_vkanban/`（.gitignore 済み）

#
# ---
#
# Repository Guidelines (Upstream)
# Repository Guidelines

## Project Structure & Module Organization
- `crates/`: Rust workspace crates — `server` (API + bins), `db` (SQLx models/migrations), `executors`, `services`, `utils`, `deployment`, `local-deployment`.
- `frontend/`: React + TypeScript app (Vite, Tailwind). Source in `frontend/src`.
- `frontend/src/components/dialogs`: Dialog components for the frontend.
- `shared/`: Generated TypeScript types (`shared/types.ts`). Do not edit directly.
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets.
- `npx-cli/`: Files published to the npm CLI package.
- `scripts/`: Dev helpers (ports, DB preparation).

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `npm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (frontend + backend with ports auto-assigned): `pnpm run dev`
- Backend (watch): `npm run backend:dev:watch`
- Frontend (dev): `npm run frontend:dev`
- Type checks: `npm run check` (frontend) and `npm run backend:check` (Rust cargo check)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `npm run generate-types` (or `generate-types:check` in CI)
- Prepare SQLx (offline): `npm run prepare-db`
- Local NPX build: `npm run build:npx` then `npm pack` in `npx-cli/`

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Frontend: ensure `npm run check` and `npm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`, optional `GITHUB_CLIENT_ID` for custom OAuth.
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
