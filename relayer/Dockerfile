FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY contracts/package.json contracts/package.json
COPY frontend/package.json frontend/package.json
COPY relayer/package.json relayer/package.json
RUN pnpm install --frozen-lockfile

COPY packages/protocol packages/protocol
COPY relayer relayer
RUN pnpm --filter @quietline/protocol build \
    && pnpm --filter @quietline/relayer build \
    && pnpm --filter @quietline/relayer deploy --prod --legacy /prod/relayer

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=build --chown=node:node /prod/relayer ./
RUN mkdir /data && chown node:node /data

ENV NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
USER node
CMD ["node", "dist/main.js"]
