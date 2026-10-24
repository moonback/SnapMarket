# Construire depuis la racine du dépôt : docker build -f apps/admin/Dockerfile -t snapmarket-admin .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace @snapmarket/admin --workspace @snapmarket/shared --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN npm run build -w @snapmarket/shared && npm run build -w @snapmarket/admin

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /repo /repo
USER app
WORKDIR /repo/apps/admin
EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
