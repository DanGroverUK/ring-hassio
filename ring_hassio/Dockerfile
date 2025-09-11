ARG BUILD_FROM
FROM $BUILD_FROM

# Add env
ENV LANG C.UTF-8

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
EXPOSE 3001/tcp

RUN apk add --no-cache \
    nodejs \
    npm \
    ffmpeg \
    git && \
    cd / && \
    git clone https://github.com/DanGroverUK/ring-hassio && \
    cd ring-hassio/ring_hassio && \
    npm install --no-package-lock && \
    # Compile TypeScript to JavaScript so the runtime has livestream.js available
    npx tsc livestream.ts || npm i -g typescript && npx tsc livestream.ts && \
    chmod a+x run.sh

CMD [ "/ring-hassio/ring_hassio/run.sh" ]
