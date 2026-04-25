# ───────────────────────────────────────────────────────────────────────────
# 栖枢 Profile — Makefile
# 常用入口:make help
# ───────────────────────────────────────────────────────────────────────────

.PHONY: help build run test lint fmt vet clean docker docker-up docker-down docker-logs

help:
	@echo "栖枢 Profile — 常用命令"
	@echo ""
	@echo "  make build          编译二进制到 ./bin/qishu"
	@echo "  make run            本地直跑(需要 .env)"
	@echo "  make test           跑单测"
	@echo "  make lint           vet + 简单静态检查"
	@echo "  make fmt            gofmt 整理所有 .go"
	@echo ""
	@echo "  make docker         构建镜像(qishu:latest)"
	@echo "  make docker-up      docker compose up -d"
	@echo "  make docker-down    docker compose down"
	@echo "  make docker-logs    docker compose logs -f"
	@echo ""
	@echo "  make clean          清理构建产物"

# ── 本地开发 ──
build:
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/qishu ./cmd/qishu

run: build
	@set -a && [ -f .env ] && . ./.env; set +a; \
	./bin/qishu

test:
	go test -race -timeout 60s ./...

lint: vet
	@echo "lint ok"

vet:
	go vet ./...

fmt:
	gofmt -w .

# ── Docker ──
docker:
	docker build -t qishu:latest .

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# ── 清理 ──
clean:
	rm -rf bin/ data/
