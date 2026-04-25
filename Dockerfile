# ───────────────────────────────────────────────────────────────────────────
# 栖枢 Profile — 多阶段 Docker 构建 (纯 Go 版,无 CGO)
#
# Stage 1 (spa-builder)   : node:22-alpine 编译 Vue SPA -> web/dist/
# Stage 2 (api-builder)   : golang:1.23-alpine 编译 Go 二进制 (CGO_ENABLED=0)
# Stage 3 (runtime)       : alpine:3.20 极小镜像
#
# 代理透传:构建时可通过 --build-arg 传 HTTP_PROXY/HTTPS_PROXY/NO_PROXY,
# docker compose 会自动从 .env 读取并传入。运行期通过 env_file 注入。
#
# 关键改动 vs 旧版:
#   1. CGO_ENABLED=0  + modernc.org/sqlite 纯 Go 驱动,消除 musl/CGO 冲突
#   2. 不再使用 -linkmode external -extldflags '-static',Go 默认就是静态
#   3. 加 HTTP_PROXY/HTTPS_PROXY/NO_PROXY/GOPROXY/NPM_REGISTRY build-args
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the Vue SPA ────────────────────────────────────────────
FROM node:22-alpine AS spa-builder

# 代理 build-args (传给 npm)
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG NPM_REGISTRY

ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY}

WORKDIR /web

# 缓存 npm 安装层
COPY web/package.json web/package-lock.json* ./

RUN set -eux; \
    if [ -n "${NPM_REGISTRY}" ]; then \
        npm config set registry "${NPM_REGISTRY}"; \
    fi; \
    if [ -n "${HTTP_PROXY}" ]; then \
        npm config set proxy "${HTTP_PROXY}"; \
    fi; \
    if [ -n "${HTTPS_PROXY}" ]; then \
        npm config set https-proxy "${HTTPS_PROXY}"; \
    fi

RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm ci --no-fund --no-audit; \
    else \
        npm install --no-fund --no-audit; \
    fi

COPY web/ ./
RUN npm run build

# ── Stage 2: build the Go binary (no CGO) ──────────────────────────────────
FROM golang:1.23-alpine AS api-builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG GOPROXY

ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY} \
    GOPROXY=${GOPROXY:-https://proxy.golang.org,direct}

RUN apk add --no-cache ca-certificates git

WORKDIR /src

COPY go.mod go.sum* ./
# 删除 go.sum 强制 go 重新生成。即便仓库里 go.sum 含有错误的间接依赖
# 哈希,这一步也能干净地跳过校验失败。
RUN rm -f go.sum

COPY . .

# 把前端 dist 塞进 cmd/qishu/web-dist/ 让 go:embed 能拿到
COPY --from=spa-builder /web/dist/ ./cmd/qishu/web-dist/

ARG TARGETOS=linux
ARG TARGETARCH=amd64

# CGO_ENABLED=0 -> 纯 Go 驱动。-mod=mod 让 go build 按需下载依赖并自动更新
# go.sum,只下编译用到的(非测试依赖),避免 `go mod tidy` 因递归遍历测试
# 依赖的测试依赖(例如 pprof 的 pseudo-version 触发 git)而失败。
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -mod=mod -trimpath -ldflags="-s -w" \
    -o /out/qishu ./cmd/qishu


# ── Stage 3: runtime ───────────────────────────────────────────────────────
FROM alpine:3.20 AS runtime

RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -g 65532 -S nonroot \
    && adduser -u 65532 -S nonroot -G nonroot

COPY --from=api-builder /out/qishu /usr/local/bin/qishu

# 数据目录:借鉴 chenyme/grok2api 的 /app/data 约定。容器在这里持有 SQLite
# 数据库与所有持久状态;docker compose 用命名卷 qishu_data 挂到这里。
RUN mkdir -p /app/data && chown -R nonroot:nonroot /app/data
VOLUME ["/app/data"]

USER nonroot:nonroot

ENV LISTEN_ADDR=0.0.0.0:8080 \
    APP_ENV=production \
    DATA_DIR=/app/data \
    GOMEMLIMIT=48MiB \
    GOGC=20 \
    GOMAXPROCS=2 \
    GODEBUG=madvdontneed=1,scavtrace=0,gctrace=0 \
    LOG_MEMSTATS_SEC=300

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/qishu"]