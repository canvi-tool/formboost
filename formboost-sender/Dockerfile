FROM node:20-slim

# Playwright dependencies
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    fonts-noto-cjk fonts-noto-cjk-extra \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production
RUN npx playwright install chromium

COPY server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
