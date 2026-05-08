# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV BODY_SIZE_LIMIT=131072
ENV ORIGIN=""
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
# Use 127.0.0.1 not localhost — alpine's /etc/hosts maps localhost to ::1
# first, and the SvelteKit/adapter-node server binds IPv4-only on 0.0.0.0.
HEALTHCHECK --interval=30s --timeout=3s CMD wget --quiet --spider http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "build"]
