# Build stage: needs dev dependencies (Nest CLI, TypeScript).
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
# The Prisma schema goes in before the install: installing generates the database client from it
# (the "postinstall" script of package.json).
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

# Production dependencies, in a stage of their own: what npm and Prisma download and keep in
# their caches (about 180 MB) stays here, and only node_modules goes on to the final image.
FROM node:22-alpine AS deps
WORKDIR /app
# Prisma looks for OpenSSL to choose the engine it generates the client for.
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
# Source maps are only read by a debugger.
RUN find node_modules -name "*.map" -type f -delete

# Runtime stage.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Prisma's query engine needs OpenSSL.
RUN apk add --no-cache openssl
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
# Writing guide for client messages, read at run time.
COPY assets ./assets
# Attachments go to a volume mounted here. The folder exists in the image with the owner the API
# runs as, and a new volume takes that owner from it.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
# Not root: the API only reads its code and writes attachments.
USER node
EXPOSE 3000
# Applies pending migrations, then starts the API. The first start also creates the initial user.
# exec replaces the shell with Node, so the stop signal of `docker stop` reaches the API
# instead of a shell that ignores it.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
