FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY eslint.config.mjs ./
RUN corepack pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN corepack pnpm --filter @opensupport/dashboard build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=build --chown=node:node /app /app
COPY LICENSE ./
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/node_modules/next/dist/bin/next", "start", "apps/dashboard", "--hostname", "0.0.0.0", "--port", "3000"]
