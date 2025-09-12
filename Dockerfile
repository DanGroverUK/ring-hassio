ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM $BUILD_FROM


# System deps: ffmpeg (with v4l2m2m), node, jq for options parsing, curl for healthcheck
RUN apk add --no-cache nodejs npm ffmpeg jq curl bash

COPY package*.json /
RUN npm install --omit=dev


# App files
COPY --chmod=777 server.js run.sh public /
#RUN chmod +x run.sh

# HLS output location

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:8080/health || exit 1
CMD ["/run.sh"]
