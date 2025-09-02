SHELL := /bin/bash

# シンプルに Docker/Compose に統一
IMAGE := vkanban:dev
UID := $(shell id -u)
GID := $(shell id -g)

.PHONY: build run run-root down logs fix-perms

build:
	@echo "[make] docker build -> $(IMAGE)"
	docker build -t $(IMAGE) -f Dockerfile .

# フォアグラウンドで compose を起動（ghost 管理と相性良し）
dev:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose up --build"
	UID=$(UID) GID=$(GID) docker compose up --build

# フォアグラウンドで compose を起動（ghost 管理と相性良し）
start:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose up --build"
	UID=$(UID) GID=$(GID) docker compose up --build -d

# Convenience: run container as root (for first boot or recovery)
run-root:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose up --build (root user)"
	UID=0 GID=0 docker compose up --build

down:
	@echo "[make] docker compose down"
	UID=$(UID) GID=$(GID) docker compose down

logs:
	@echo "[make] docker compose logs -f"
	UID=$(UID) GID=$(GID) docker compose logs -f

# Fix file ownership of bind-mounted dirs so the container user can write
fix-perms:
	@echo "[make] fixing file ownership in ./data and ./var_tmp_vkanban"
	@if command -v sudo >/dev/null 2>&1; then \
		echo "[make] using sudo chown"; \
		sudo chown -R $(UID):$(GID) $(PWD)/data $(PWD)/var_tmp_vkanban; \
	else \
		echo "[make] using docker to chown (no sudo)"; \
		docker run --rm -v $(PWD)/data:/data -v $(PWD)/var_tmp_vkanban:/var_tmp_vkanban alpine:3 sh -c "chown -R $(UID):$(GID) /data /var_tmp_vkanban"; \
	fi
