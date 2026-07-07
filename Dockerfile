FROM node:20-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npx tsc -p tsconfig.json --skipLibCheck --noEmitOnError false || true

RUN mkdir -p uploads

EXPOSE 3001
CMD npx prisma db push --accept-data-loss && node dist/main
