SHELL := /bin/bash

# シンプルに Docker/Compose に統一
IMAGE := vkanban:dev
UID := $(shell id -u)
GID := $(shell id -g)

.PHONY: build run down logs

build:
	@echo "[make] docker build -> $(IMAGE)"
	docker build -t $(IMAGE) -f Dockerfile .

# フォアグラウンドで compose を起動（ghost 管理と相性良し）
run:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	@echo "[make] docker compose up --build"
	UID=$(UID) GID=$(GID) docker compose up --build

down:
	@echo "[make] docker compose down"
	UID=$(UID) GID=$(GID) docker compose down

logs:
	@echo "[make] docker compose logs -f"
	UID=$(UID) GID=$(GID) docker compose logs -f
