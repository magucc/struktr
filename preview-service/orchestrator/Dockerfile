FROM node:22-bookworm-slim

# adb talks to the emulator containers over the struktr docker network
RUN apt-get update && apt-get install -y --no-install-recommends adb ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev=false
COPY tsconfig.json ./
COPY src ./src
COPY static ./static
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
