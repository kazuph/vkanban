---
kiro:
  include: always
  last_updated: 2025-09-11
---

# Product Overview — Vibe Kanban (vkanban)

Brief
- Vibe Kanban helps engineers orchestrate AI coding agents across projects. It provides a kanban-like workflow for planning, running, and reviewing agent-driven work with a clear audit trail and fast iteration loops.

Core Features
- Multi‑agent orchestration: switch between and coordinate different coding agents (Claude Code, Gemini CLI, Codex, Amp, etc.).
- Task/attempt lifecycle: projects → tasks → attempts with status tracking and live updates via server‑sent events.
- Review tools: diff/log viewers and streamlined review flows; quick hooks for starting dev servers from the UI.
- Centralized agent config: one place to manage executor (formerly “profiles”) configuration and MCP settings.
- Unified data/storage: single asset directory for config/DB/images across dev and Docker to reduce environment drift.

Target Use Cases
- Individual developers orchestrating multiple coding agents across several repos.
- Teams standardizing how agents run, log, and report progress while keeping local dev fast.
- Review‑driven workflows where human engineers plan/approve and agents execute.

Key Value Propositions
- Faster iteration: plan → run → review loops optimized for agent workflows.
- Consistency: shared configuration (executors/MCP) and a single asset store cut environment mismatch.
- Visibility: structured tasks/attempts, rich logs, and diffs make agent activity auditable.

Recent Product Changes (2025‑09)
- UI refresh adopting Nice Modal for dialogs; redesigned log view; dark‑mode fixes; reconnect stability; faster file search.
- Settings model: “profiles” renamed to “executors” with backward‑compatible loading.
- Database: migrations added on 2025‑09‑02, ‑03, ‑05; auto‑migration on first boot.
- Frontend: Vite plugin exposes `virtual:executor-schemas` for dynamic forms.

Out of Scope (Today)
- Cloud multi‑tenant control plane and billing (this repo focuses on local/dev + Docker usage).

Notes
- This fork tracks upstream BloopAI/vibe‑kanban (synced through 0.0.78 as of 2025‑09‑08) while retaining vkanban’s Docker/Compose and dev ergonomics.

Changelog Handling
- Mark functional deprecations explicitly; preserve user custom sections; prefer additive updates; date significant changes.

