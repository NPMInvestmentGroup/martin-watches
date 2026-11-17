# Stage 1: build gallery thumbnails, the curated Gallery page and its photo redirects
FROM node:20-alpine AS build
WORKDIR /tools
RUN npm init -y >/dev/null && npm install sharp
WORKDIR /app
COPY . .
RUN NODE_PATH=/tools/node_modules node scripts/build-gallery.js \
 && NODE_PATH=/tools/node_modules node scripts/build-curated-gallery.js /tools/gallery-redirects.map \
 && rm -rf scripts Dockerfile nginx.conf

# Stage 2: serve
FROM nginx:alpine
COPY --from=build /app /usr/share/nginx/html
COPY --from=build /tools/gallery-redirects.map /etc/nginx/gallery-redirects.map
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
