# TODO: PR #4 コンフリクト解消タスクリスト（vk/move-attempt-actions-to-header）

このファイルは PR #4（ブランチ: `vk/move-attempt-actions-to-header`）の競合解消を引き継ぐための作業メモです。上流取り込みで大規模変更（profiles→executors など）が入っているため、段階的に解消します。

## 現状（2025-09-09）
- 手元は rebase 途中で停止中（約 12/77）。
- 直近で止まっている競合: `frontend/src/pages/project-tasks.tsx`（タスク一覧のストリーミング導入コミット）。
- 既に解消済み（例）
  - `useExecutionProcesses` は upstream で削除 → 参照を除去済み。
  - `GitHubLoginDialog.tsx` の UI 差分を統合。
  - 文書統合: `AGENTS.md` / `DEVELOPER_GUIDE.md` の二重化を解消。
  - `package.json` はバージョン `0.0.72`、name はフォークの `@kazuph/vkanban` を維持。
  - `McpServers.tsx` は新 API（`McpServerQuery = { executor: BaseCodingAgent }`）に追従済み。

## 方針（選択）
- [ ] A. Rebase を継続（履歴をきれいに保つ）〈目安 20–30 分〉
- [ ] B. Rebase を中止して `main` をブランチへマージ（早い）〈目安 10–15 分〉

以下は A（Rebase 継続）の手順です。B を選ぶ場合は最下部の「マージ切替」を参照。

## 手順（A: Rebase 継続）
- [ ] 事前準備
  - `git fetch origin --prune`
  - （未コミットがあれば）`git stash -u -m rebase-save` で退避
  - ブランチ確認: `git checkout vk/move-attempt-actions-to-header`
- [ ] Rebase の再開状況を確認
  - `git status` / `git diff --name-only --diff-filter=U`
  - 競合ファイルを 1 つずつ解消 → `git add -A` → `git rebase --continue`
- [ ] 競合: `frontend/src/pages/project-tasks.tsx`
  - 上流の「プロジェクトタスクのストリーミング（SSE）」実装に合わせる。
  - 本ブランチの UI 改修（Attempt アクションのヘッダー移設など）の意図は維持する。
  - 参考: 新規追加された `frontend/src/hooks/useProjectTasks.ts` を使う実装へ寄せる。
- [ ] 以降に出がちな競合の解消方針
  - `package.json`: name は `@kazuph/vkanban` を維持。version は upstream に追従（現状 `0.0.72`）。
  - MCP 設定ページ: 既に `mcpServersApi.load/save({ executor: <BaseCodingAgent> })` へ統一済み。追加競合も同方針で。
  - 文書系: `AGENTS.md` を主として採用（重複・古い記述は統合）。
  - 廃止フック: `useExecutionProcesses` の残存参照があれば除去。
- [ ] 各停止点での検証
  - Rust: `cargo check`
  - Frontend: `pnpm -C frontend i && pnpm -C frontend check`
  - 必要に応じて TS 型再生成: `npm run generate-types`（または `generate-types:check`）
- [ ] 最終 push
  - `git push --force-with-lease origin HEAD:vk/move-attempt-actions-to-header`
  - PR #4 を更新、`needs-review` ラベル付与

## 手順（B: マージ切替・早さ優先）
- [ ] Rebase を中止: `git rebase --abort`
- [ ] ブランチへ最新をマージ: `git checkout vk/move-attempt-actions-to-header && git merge origin/main`
- [ ] 上記「競合の解消方針」「検証」を踏襲して解消
- [ ] `git push origin vk/move-attempt-actions-to-header`

## ルール / 注意
- 余計な変更を含めない（`git status` を都度確認、対象外ファイルはステージしない）。
- `package.json` の name はフォーク名 `@kazuph/vkanban` を維持する。
- 強制更新が必要な場合は `--force-with-lease` を使い、他者の push を保護する。

## 参考コマンド（抜粋）
```bash
# 競合中のファイル一覧
git diff --name-only --diff-filter=U

# 競合を解消 → 継続
git add -A && git rebase --continue

# 途中でやり直す
git rebase --abort

# 検証
cargo check
pnpm -C frontend i && pnpm -C frontend check
```

---
この `todo.md` は引き継ぎ用の最小チェックリストです。詳細な背景や判断理由は `.vk-conflict-plan.md` を参照してください。
