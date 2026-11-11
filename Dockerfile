FROM node:22-slim
WORKDIR /app
# Git é necessário para instalar a dependência do Baileys a partir de um fork com correção de pareamento.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# Instala com deps de build (prepare compila o fork) e depois remove devDependencies.
RUN npm install --no-audit --no-fund && npm prune --omit=dev
COPY . .
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "src/server.js"]
