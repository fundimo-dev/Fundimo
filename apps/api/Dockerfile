FROM node:20-alpine AS base

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Copy dependency files first (better layer caching)
COPY package.json package-lock.json ./
COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

# Install ALL deps (including dev) so nest build works
RUN npm install --include=dev

RUN npx prisma generate --schema=./prisma/schema.prisma

RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && node dist/main.js"]

