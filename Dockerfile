# =============================================================================
# World Monitor — Docker Image
# =============================================================================
# Multi-stage build:
#   builder  — installs deps, compiles TS handlers, builds Vite frontend
#   final    — nginx (static) + node (API) under supervisord
# =============================================================================

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install root dependencies (layer-cached until package.json changes)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy full source
COPY . .

# Compile TypeScript API handlers → self-contained ESM bundles
# Output is api/**/*.js alongside the source .ts files
RUN node docker/build-handlers.mjs

# Build Vite frontend (outputs to dist/)
# Skip blog build — blog-site has its own deps not installed here
RUN npx tsc && npx vite build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS final

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# API server
COPY --from=builder /app/src-tauri/sidecar/local-api-server.mjs ./local-api-server.mjs
COPY --from=builder /app/src-tauri/sidecar/package.json ./package.json

# API handler modules (JS originals + compiled TS bundles)
COPY --from=builder /app/api ./api

# Static data files used by handlers at runtime
COPY --from=builder /app/data ./data

# Built frontend static files
COPY --from=builder /app/dist /usr/share/nginx/html

COPY docker/dokploy-server.mjs ./dokploy-server.mjs

# Ensure writable dirs for non-root
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:8080/ >/dev/null || exit 1

CMD ["node", "/app/dokploy-server.mjs"]
