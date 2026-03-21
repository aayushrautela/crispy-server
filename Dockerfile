FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY migrations ./migrations
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY --from=build /app/dist ./dist

EXPOSE 18765

CMD ["npm", "run", "start:api"]
