FROM node:20-alpine

RUN apk add --no-cache openssl

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY apps/api ./apps/api

RUN pnpm install --filter @fundimo/api...

RUN cd apps/api && npx prisma generate --schema=./prisma/schema.prisma

RUN cd apps/api && pnpm run build

EXPOSE 3000

CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy --schema=./prisma/schema.prisma ; node dist/main.js"]
