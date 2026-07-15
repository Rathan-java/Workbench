# =============================================================================
#  Ara Workbench SPA — production image
#
#  The build stage compiles; the runtime stage is nginx serving static files.
#  The final image contains no Node, no npm, no source and no node_modules —
#  about 50 MB instead of about 500 MB, and nothing in it that can execute
#  JavaScript on the server side.
# =============================================================================

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Baked in at build time, not runtime: Vite inlines env vars into the bundle, so
# this is a build argument and NOT a secret. Nothing sensitive may ever go here —
# anything referenced as import.meta.env ends up readable in the browser.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build


# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine AS production

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# nginx's own worker processes already drop to an unprivileged user, but the
# master runs as root to bind :80. Bind :8080 instead and run the whole thing
# unprivileged — a container that never needs root should never have it.
RUN sed -i 's/listen\s*80;/listen 8080;/' /etc/nginx/conf.d/default.conf \
 && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf \
 && sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
 && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
