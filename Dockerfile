FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HEADLESS=true
ENV CREDENTIALS_PATH=/app/credentials/.worker-credentials.json

RUN mkdir -p /app/credentials && chmod 700 /app/credentials

CMD ["node", "dist/index.js"]
