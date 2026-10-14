FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HEADLESS=true

CMD ["node", "dist/index.js"]
