# syntax=docker/dockerfile:1
#
# Two deployable images from one file:
#   docker build --target directus -t acciones-iso-directus .
#   docker build --target web      -t acciones-iso-web .
#
# Pin DIRECTUS_VERSION to an exact release (or digest) before production; "11" floats.
ARG DIRECTUS_VERSION=11
ARG NODE_VERSION=22

# ---- Directus + our extensions (hooks that enforce the domain rules) ----
FROM node:${NODE_VERSION}-alpine AS extensions-build
WORKDIR /build
COPY domain/ ./domain/
COPY extensions/ ./extensions/
# Each extension lives in extensions/<name>/ with its own package.json and a "build" script.
# No-op while extensions/ is empty.
RUN set -e; \
    for d in extensions/*/; do \
      [ -f "$d/package.json" ] || continue; \
      (cd "$d" && npm ci && npm run build); \
    done

FROM directus/directus:${DIRECTUS_VERSION} AS directus
USER root
RUN mkdir -p /directus/extensions && chown node:node /directus/extensions
USER node
COPY --from=extensions-build --chown=node:node /build/extensions/ /directus/extensions/
# SQL Server is configured at runtime: DB_CLIENT=mssql DB_HOST=... (see .env.example / compose.yaml)
EXPOSE 8055

# ---- UI build (ui/ is created in phase 3 of docs/PLAN.md) ----
FROM node:${NODE_VERSION}-alpine AS ui-build
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY domain/ /domain/
COPY ui/ ./
ARG VITE_DIRECTUS_URL=/api
ENV VITE_DIRECTUS_URL=${VITE_DIRECTUS_URL}
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=ui-build /ui/dist /usr/share/nginx/html
EXPOSE 80
