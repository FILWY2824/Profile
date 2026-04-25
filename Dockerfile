# ───────────────────────────────────────────────────────────────────────────
# 栖枢 Profile — 多阶段 Docker 构建
#
# 阶段 1 (spa-builder)  : node:22-alpine 跑 vite,产出 web/dist/
# 阶段 2 (api-builder)  : golang:1.22-alpine 把 dist 复制进 cmd/qishu/web-dist/
#                          再 CGO 编译 Go 二进制,SPA 已 //go:embed 进去
# 阶段 3 (runtime)      : alpine:3.20,只装 ca-certs + tzdata,二进制即程序
#
# 最终镜像 ~25 MB(多了约 5 MB 的嵌入 SPA),空载内存 ~35 MB。
# 单容器一键部署,docker compose up -d 即可。
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the Vue SPA ────────────────────────────────────────────
FROM node:22-alpine AS spa-builder

WORKDIR /web

# Cache npm install layer: copy package files first, then run install,
# only after that copy sources. This way changes to src/*.vue don't bust
# the npm cache.
COPY web/package.json web/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-fund --no-audit

COPY web/ ./
RUN npm run build
# After this stage: /web/dist/index.html + /web/dist/assets/*

# ── Stage 2: build the Go binary with embedded SPA ────────────────────────
FROM golang:1.23-alpine AS api-builder

RUN apk add --no-cache ca-certificates git gcc musl-dev

WORKDIR /src

# Cache module download separately from sources for faster rebuilds.
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# Drop the SPA build into cmd/qishu/web-dist/ so go:embed picks it up.
# Using --from=spa-builder keeps the final image free of any node tooling.
COPY --from=spa-builder /web/dist/ ./cmd/qishu/web-dist/

ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -linkmode external -extldflags '-static'" \
    -tags "sqlite_omit_load_extension" \
    -o /out/qishu ./cmd/qishu


# ── Stage 3: runtime ──────────────────────────────────────────────────────
FROM alpine:3.20 AS runtime

RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -g 65532 -S nonroot \
    && adduser -u 65532 -S nonroot -G nonroot

COPY --from=api-builder /out/qishu /usr/local/bin/qishu

RUN mkdir -p /data && chown -R nonroot:nonroot /data
VOLUME ["/data"]

USER nonroot:nonroot

ENV LISTEN_ADDR=0.0.0.0:8080 \
    APP_ENV=production \
    DATA_DIR=/data \
    GOMEMLIMIT=80MiB \
    GOGC=50

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/qishu"]
