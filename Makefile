SHELL := /bin/bash

# Fixed configuration (変更したければここを書き換え)
IMAGE := vkanban:dev
NAME  := vkanban
PORT  := 8080
HOST_PORT := 8080

CNTR_CONTAINER := container
CNTR_DOCKER    := docker

RUN_FLAGS := --rm --name $(NAME) -p $(HOST_PORT):$(PORT) \
	-e HOST=0.0.0.0 -e PORT=$(PORT) \
	-e VIBE_KANBAN_ASSET_MODE=prod -e VIBE_KANBAN_ASSET_DIR=/data \
	-v $(PWD)/data:/data -v $(PWD)/var_tmp_vkanban:/var/tmp/vibe-kanban

.PHONY: build run build_container run_container build_docker run_docker docker-build docker-run container-build container-run

check-container:
	@command -v $(CNTR_CONTAINER) >/dev/null 2>&1 || { \
		echo "Error: '$(CNTR_CONTAINER)' command not found (macOS container CLI)"; \
		exit 1; \
	}

check-docker:
	@command -v $(CNTR_DOCKER) >/dev/null 2>&1 || { \
		echo "Error: '$(CNTR_DOCKER)' command not found"; \
		exit 1; \
	}

# Auto-detect: container(=macOS) があれば container、なければ docker（=Linux）
build:
	@CNTR=$$(command -v $(CNTR_CONTAINER) >/dev/null 2>&1 && echo $(CNTR_CONTAINER) || echo $(CNTR_DOCKER)); \
	echo "[make] using $$CNTR"; \
	$$CNTR build -t $(IMAGE) -f Dockerfile .

run:
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban; \
	CNTR=$$(command -v $(CNTR_CONTAINER) >/dev/null 2>&1 && echo $(CNTR_CONTAINER) || echo $(CNTR_DOCKER)); \
	echo "[make] using $$CNTR"; \
	IMGID=$$($$CNTR images -q $(IMAGE) 2>/dev/null || true); \
	if [ -z "$$IMGID" ]; then \
	  echo "[make] image '$(IMAGE)' not found locally. Building..."; \
	  $$CNTR build -t $(IMAGE) -f Dockerfile .; \
	fi; \
	$$CNTR run $(RUN_FLAGS) $(IMAGE)

build_container: check-container
	$(CNTR_CONTAINER) build -t $(IMAGE) -f Dockerfile .

run_container: check-container
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	$(CNTR_CONTAINER) run $(RUN_FLAGS) $(IMAGE)

# Docker alternatives（必要ならこちらを利用）
build_docker: check-docker
	$(CNTR_DOCKER) build -t $(IMAGE) -f Dockerfile .

run_docker: check-docker
	@mkdir -p $(PWD)/data $(PWD)/var_tmp_vkanban
	$(CNTR_DOCKER) run $(RUN_FLAGS) $(IMAGE)

# Hyphen aliases
docker-build: build_docker
docker-run: run_docker
container-build: build_container
container-run: run_container
