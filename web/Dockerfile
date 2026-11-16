FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

# nginx serves the built app and forwards /api to the API container. The current stable branch of
# nginx, which still gets its security fixes; a new one comes out every April.
FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80
