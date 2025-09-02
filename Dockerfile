# syntax=docker/dockerfile:1.7-labs

# ---------- Build args (override at build time if needed) ----------
ARG NODE_VERSION=22
ARG RUST_VERSION=1.82
ARG PNPM_VERSION=9

# ---------- Frontend: deps ----------
FROM node:${NODE_VERSION}-bookworm AS frontend-deps
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH="/root/.local/share/pnpm:${PATH}"
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy only manifests for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY npx-cli/package.json ./npx-cli/

# Install dependencies using cache mounts (fast, reproducible)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- Frontend: build ----------
FROM frontend-deps AS frontend-build
COPY frontend/ ./frontend/
COPY shared/ ./shared/
# pnpm workspace の filter 名称に頼らず、ディレクトリ指定でビルド
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm -C frontend build

# ---------- Backend: base ----------
FROM rust:${RUST_VERSION}-bookworm AS backend-base
WORKDIR /app
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
    CARGO_TERM_COLOR=always \
    # Lower memory pressure for large deps (octocrab/hyper/rustls)
    RUSTFLAGS="-C debuginfo=0 -C opt-level=2 -C codegen-units=32 -C lto=off"

# System deps for compiling Rust crates
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      pkg-config build-essential ca-certificates git clang lld \
    && rm -rf /var/lib/apt/lists/*

# Install nightly toolchain for edition 2024 crates
RUN rustup toolchain install nightly -c rustc,cargo,rust-std --profile minimal

# ---------- Backend: build ----------
FROM backend-base AS backend-build
# Copy manifests first (best-effort cache) then fetch deps
COPY Cargo.toml ./
COPY crates ./crates
COPY assets ./assets

# Bring in built frontend assets for rust-embed
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Build with cache mounts (registry + target). Limit parallelism to reduce memory.
ENV SQLX_OFFLINE=true
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    /usr/local/cargo/bin/cargo +nightly build -p server --release -j 1 \
    && mkdir -p /app/dist \
    && cp target/release/server /app/dist/vibe-kanban

# ---------- Runtime ----------
FROM debian:bookworm-slim AS runtime
# CWD を /repos に固定し、相対パスのプロジェクト指定（例: "kazuph/vkanban"）を
# /repos/kazuph/vkanban として解決できるようにする
WORKDIR /repos

LABEL org.opencontainers.image.title="vkanban" \
      org.opencontainers.image.description="Vibe Kanban server with embedded frontend" \
      org.opencontainers.image.source="https://github.com/kazuph/vkanban" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini git \
    && rm -rf /var/lib/apt/lists/*

# Configure git system-wide safe directories so libgit2 accepts bind-mounted repos
RUN git config --system --add safe.directory /repos \
 && git config --system --add safe.directory /repos/* \
 && git config --system --add safe.directory '*'

# Runtime defaults (overridable)
ENV VIBE_KANBAN_ASSET_MODE=prod \
    HOST=0.0.0.0 \
    PORT=8080

# Copy compiled binary only (materialized from cache mount)
COPY --from=backend-build /app/dist/vibe-kanban /usr/local/bin/vibe-kanban

# Minimal entrypoint to configure git safe.directory and start the app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
