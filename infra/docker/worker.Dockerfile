FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json

RUN npm ci \
  && npx playwright install --with-deps chromium \
  && apt-get update \
  && apt-get install -y --no-install-recommends socat \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

COPY . .

CMD ["sh", "-lc", "if [ -n \"${CHROMIUM_CDP_PUBLIC_PORT:-}\" ] && [ \"${CHROMIUM_CDP_PUBLIC_PORT}\" != \"${CHROMIUM_CDP_PORT}\" ]; then socat TCP-LISTEN:${CHROMIUM_CDP_PUBLIC_PORT},fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:${CHROMIUM_CDP_PORT} & fi; npm run start --workspace @nuoma/worker"]
