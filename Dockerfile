ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM $BUILD_FROM

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
EXPOSE 8080/tcp


# System deps: ffmpeg (with v4l2m2m), node, jq for options parsing, curl for healthcheck
RUN apk add --no-cache nodejs npm ffmpeg jq curl bash

COPY package*.json /
RUN npm install --omit=dev

# HLS output location

# HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:8080/health || exit 1

WORKDIR /
COPY rootfs /
RUN chmod +x /ringcam/run.sh
CMD ["/ringcam/run.sh"]
