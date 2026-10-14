FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HEADLESS=true

CMD ["node", "dist/index.js"]
