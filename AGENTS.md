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

