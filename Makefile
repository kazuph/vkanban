SHELL := /bin/bash

# シンプルに Docker/Compose に統一
IMAGE := vkanban:dev
UID := $(shell id -u)
GID := $(shell id -g)

# Browser URL to open before starting compose
BROWSER_URL ?= http://127.0.0.1:8080

# Detect current repo path and canonical org/repo for /repos mount (simple, quote-safe)
REPO_TOP := $(shell git rev-parse --show-toplevel 2>/dev/null || pwd)
REPO_NAME := $(notdir $(REPO_TOP))
REPO_PARENT := $(patsubst %/,%,$(dir $(REPO_TOP)))
# Default org = parent directory name; allow override by env (REPO_ORG) or full canon (REPO_CANON)
ifeq ($(origin REPO_ORG), undefined)
  REPO_ORG := $(notdir $(REPO_PARENT))
endif
ifeq ($(origin REPO_CANON), undefined)
  REPO_CANON := $(REPO_ORG)/$(REPO_NAME)
endif

.PHONY: build run run-root down logs fix-perms

build:
	@echo "[make] docker build -> $(IMAGE)"
	docker build -t $(IMAGE) -f Dockerfile .

# フォアグラウンドで compose を起動（ghost 管理と相性良し）
dev:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose build; open $(BROWSER_URL); docker compose up --build"
	/bin/sh -lc 'UID=$(UID) GID=$(GID) HOME=$(HOME) REPO_ABS_PATH=$(REPO_TOP) REPO_CANON=$(REPO_CANON) docker compose build && \
	  (open "$(BROWSER_URL)" || xdg-open "$(BROWSER_URL)" || echo "[make] please open $(BROWSER_URL) manually") && \
	  UID=$(UID) GID=$(GID) HOME=$(HOME) REPO_ABS_PATH=$(REPO_TOP) REPO_CANON=$(REPO_CANON) docker compose up --build'

# フォアグラウンドで compose を起動（ghost 管理と相性良し）
start:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose build; open $(BROWSER_URL); docker compose up --build -d"
	/bin/sh -lc 'UID=$(UID) GID=$(GID) HOME=$(HOME) REPO_ABS_PATH=$(REPO_TOP) REPO_CANON=$(REPO_CANON) docker compose build && \
	  (open "$(BROWSER_URL)" || xdg-open "$(BROWSER_URL)" || echo "[make] please open $(BROWSER_URL) manually") && \
	  UID=$(UID) GID=$(GID) HOME=$(HOME) REPO_ABS_PATH=$(REPO_TOP) REPO_CANON=$(REPO_CANON) docker compose up --build -d'

# Backward compatible alias
run: dev

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
