# Stage 1: build gallery thumbnails + gallery.json
FROM node:20-alpine AS build
WORKDIR /tools
RUN npm init -y >/dev/null && npm install sharp
WORKDIR /app
COPY . .
RUN NODE_PATH=/tools/node_modules node scripts/build-gallery.js && rm -rf scripts

# Stage 2: serve
FROM nginx:alpine
COPY --from=build /app /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
