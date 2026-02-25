# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /build

# Install dependencies first (separate layer for caching)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production deps only
RUN npm ci --omit=dev

# ── Stage 2: Setup (Azure CLI + Node.js — only used by the setup service) ─────
FROM mcr.microsoft.com/azure-cli AS setup
WORKDIR /app

# The azure-cli image is Alpine-based; add Node.js on top
RUN apk add --no-cache nodejs npm

# Install all deps (including devDeps — tsx is needed to run the script)
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY config.example.json ./config.example.json

CMD ["npm", "run", "setup:azure"]

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S bridge && adduser -S bridge -G bridge

# Copy compiled output and production node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json
COPY config.example.json ./config.example.json

# Persistent directories for user data and plugins
RUN mkdir -p /app/data /app/plugins && chown -R bridge:bridge /app

USER bridge

EXPOSE 3333 3334

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3333/ping || exit 1

CMD ["node", "dist/index.js"]
