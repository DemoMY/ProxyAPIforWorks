FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    LLM_GATE_DATA_DIR=/data \
    LLM_GATE_HOST=0.0.0.0 \
    LLM_GATE_UI_PORT=7777 \
    LLM_GATE_PROXY_PORT=8082
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown -R app:app /data
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./
USER app
VOLUME ["/data"]
EXPOSE 7777 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8082/health || exit 1
CMD ["node", "dist/cli.js"]
