FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY relayer/package.json relayer/package.json
RUN --mount=type=cache,id=quietline-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --filter @quietline/relayer... --frozen-lockfile

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
