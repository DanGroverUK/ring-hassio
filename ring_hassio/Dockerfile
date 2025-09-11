# syntax=docker/dockerfile:1
# Multi-arch (Pi 5 = aarch64). HA's build system swaps BUILD_FROM automatically.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM ${BUILD_FROM}

# System deps: ffmpeg (with v4l2m2m), node, jq for options parsing, curl for healthcheck
RUN apk add --no-cache nodejs npm ffmpeg jq curl bash

WORKDIR /opt/ring
COPY package*.json ./
RUN npm ci --omit=dev

# App files
COPY server.js ./
COPY run.sh /run.sh
RUN chmod +x /run.sh

# HLS output location
RUN mkdir -p /opt/ring/public

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:8080/health || exit 1
CMD ["/run.sh"]
