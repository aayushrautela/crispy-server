FROM node:22-bookworm-slim AS base
WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start:api"]
