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
# No transport-layer body cap. In @sveltejs/adapter-node, `Infinity` disables the
# cap; `0` does NOT mean unlimited — it is a literal 0-byte limit that rejects every
# request with a body (the adapter even prints "specify Infinity rather than 0"). The
# OCR upload is the only route that buffers a large body, and it enforces its own
# app-level limit (OCR_MAX_IMAGE_MB, default 5 MiB) that returns a clean 413. A tight
# cap here previously (131072 = 128 KiB) sat *below* that policy, so resized pump
# photos were truncated mid-stream and surfaced as a bogus `400 multipart parse
# failed` in production only. See docs/technical/photo-ocr.md.
ENV BODY_SIZE_LIMIT=Infinity
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
