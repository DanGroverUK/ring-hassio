ARG BUILD_FROM
FROM $BUILD_FROM

# System deps: ffmpeg (with v4l2m2m), node, jq for options parsing, curl for healthcheck
RUN apk add --no-cache nodejs npm ffmpeg jq curl bash

RUN mkdir -p /opt/ring
WORKDIR /opt/ring
COPY package*.json ./
RUN npm install --omit=dev

# App files
COPY server.js ./
COPY run.sh /run.sh
RUN chmod +x /run.sh

# HLS output location
RUN mkdir -p /opt/ring/public && chmod 755 /opt/ring/public

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:8080/health || exit 1
CMD ["/run.sh"]
