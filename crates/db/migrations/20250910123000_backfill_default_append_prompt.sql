-- Backfill default project-level prompt instructions where missing
UPDATE projects
SET append_prompt = '


[Git/PR Workflow]
- 作業用ブランチは `vk/<短い-kebab-説明>` で作成（なければ作成）。
- 実装ごとに小さくコミットし、意図ごとに分割。
- 初回は `git push -u origin HEAD`、以降の修正も都度 `git push`。
- PR が無い場合は `gh pr create --fill --web` で作成。既にある場合は `gh pr view --web` でブラウザを開く。
- タスク完了時は上記コマンドで PR をブラウザで開いた状態にする。
- 可能ならリンター/テスト/ビルドを実行し、失敗時は修正して再 push.'
WHERE append_prompt IS NULL OR TRIM(append_prompt) = '';

