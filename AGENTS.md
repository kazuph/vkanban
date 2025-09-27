# AGENTS Runbook

このリポジトリの運用ノウハウ（簡潔版）。

- すべてのオペレーション判断は「英語で考え、日本語で回答」すること。内部での思考・メモ・コメントは英語ベース、ユーザー向け出力は自然な日本語で整える。

## Git/PR Workflow (Default)
- Commit in small, implementation-scoped chunks, split by intent, and push after each cohesive change.
- If no PR exists, create one with the gh CLI; if a PR already exists, open it with `gh pr view --web`. Use Japanese for the PR title and description.
- When a task is completed, always leave the PR open in the browser using the command above.
- Reviews and CI tests run on the PR; address only important items, and if tests fail, fix them and push again.

## Docker/Compose

- 起動: `make run`
  - フロー: `docker compose build` → `open http://127.0.0.1:8080` → `docker compose up --build`
- ログ: `make logs`
- 停止: `make down`
- 権限修復: `make fix-perms`（`./data` と `./var_tmp_vkanban` の所有権整備）
- 最悪時復旧: `make run-root` → Ctrl-C → `make fix-perms` → `make run`

### マウント/永続ディレクトリ
- `/data` ↔ `./data`（アセット、DB、設定、画像キャッシュ）
- `/var/tmp/vibe-kanban` ↔ `./var_tmp_vkanban`（ワークツリー/一時ファイル）
- `/repos/<org>/<repo>` ↔ `現在の Git リポジトリ`（pnpm dev と同じプロジェクトを参照）
- `${HOME}` ↔ `${HOME}`（ホストのホームディレクトリを同一絶対パスでマウント）
  - コンテナ内の `HOME` 環境変数もホストと同じ `${HOME}` に設定。

  - `make run`/`make start` は、実行中の repo を自動的に `/repos/<org>/<repo>` にマウントします。
  - 自動検出: `REPO_ABS_PATH` は `git rev-parse --show-toplevel`、`REPO_CANON` は `git remote origin` から `<org>/<repo>` を推定。
  - 明示指定も可能: `REPO_ABS_PATH=/path/to/project REPO_CANON=myorg/myrepo make run`
  - 直接 `docker compose up --build` する場合、未設定でも動く既定値あり：
    - `REPO_ABS_PATH` 既定 `.`（compose.yml のあるディレクトリ）
    - `REPO_CANON` 既定 `kazuph/vkanban`
    - 別リポジトリを使う場合は、上記 2 変数を環境に指定して実行してください。
  - 補足: `${HOME}` を同一パスでマウントしているため、Docker 実行時でもホストと同じ絶対パス（例: `/Users/<you>/...` や `/home/<you>/...`）のリポジトリを参照できます。これにより、`pnpm dev` と `make run`（Docker）の参照パス差異を解消しています。

### よくある問題と対処
- PermissionDenied で起動失敗: `./data` 配下のファイルが root 所有。
  - 対処: `make fix-perms` または `sudo chown -R $(id -u):$(id -g) data var_tmp_vkanban`
  - 再生成: `rm -f data/config.json data/profiles.json data/db.sqlite*` 後に `make run`
- 画像キャッシュ書き込みエラー: `/data/images` が書き込み不可。
  - エントリポイントで自動作成＆診断出力あり。所有権を修復して再起動。
- コンテナ内でブラウザが開けない警告: 仕様上問題なし。`http://127.0.0.1:8080` を手動で開く。
  - `make run`/`make start` はビルド後に `open` を実行してから起動します。

### デバッグ Tips
- 详细ログ: `RUST_LOG=debug UID=$(id -u) GID=$(id -g) docker compose up`
- コンテナ内の状態確認: `docker compose exec vkanban sh -lc 'id && ls -la /data && ls -ld /var/tmp/vibe-kanban'`

### 補足
- コンテナはホストの `${UID}:${GID}` で動作。`./data` は常に自ユーザー所有に維持。
- Rust のビルドが重いため、通常は `--no-cache` を使わない。
- ローカル実行用のディレクトリは Git 追跡外: `data/`, `var_tmp_vkanban/`（.gitignore 済み）
  
## Upstream Sync 2025-09-08

- 取り込み元: `BloopAI/vibe-kanban@main`（v0.0.78 相当）
- 反映ブランチ: `sync/upstream-v0.0.78`

含まれる主な変更（抜粋）
- UI: Nice Modal 採用（ダイアログ刷新）、ログビュー再設計、ダークモード修正、再接続周りの安定化、ファイル検索高速化等。
- 設定モデル: "profiles" → "executors"（後方互換の読み込みあり）。
- DB: 新規マイグレーション追加（2025-09-02, -03, -05）。
- Frontend: `virtual:executor-schemas` を Vite プラグインで提供。

運用メモ
- DB バックアップ推奨: `cp -a data/db.sqlite data/db.sqlite.bak.$(date +%Y%m%d-%H%M%S)`
- 初回起動時に自動マイグレーションが走ります。失敗時はバックアップから復旧してください。
- Docker/Compose（Makefile/compose.yml）は vkanban 流儀を維持（上流の削除・変更は採用しません）。
- Vite 開発サーバはこれまで通り外部アクセス/HMR 明示/allowedHosts 拡張を保持しつつ、上流のスキーマプラグインを追加済み。

ブランチ運用
- 上流の命名規約: `vk/xxxx-xxxx-xxxx`（必要に応じ採用）。
