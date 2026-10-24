# Image de l'API et du worker (même image, commande différente).
# Construire depuis la racine du dépôt : docker build -f apps/api/Dockerfile -t snapmarket-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY prisma prisma
RUN npm ci --workspace @snapmarket/api --workspace @snapmarket/shared --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npx prisma generate && npm run build -w @snapmarket/shared && npm run build -w @snapmarket/api
RUN npm prune --omit=dev --workspace @snapmarket/api --workspace @snapmarket/shared --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app app
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/prisma prisma
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
USER app
WORKDIR /repo/apps/api
EXPOSE 3000
# Worker : docker run … snapmarket-api node dist/worker.js
CMD ["node", "dist/main.js"]
