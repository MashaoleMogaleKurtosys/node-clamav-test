# This Dockerfile is for the ClamAV service (handled by docker-compose)
# The backend Dockerfile is Dockerfile.backend

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY server.js ./

RUN mkdir -p uploads quarantine

EXPOSE 3001

CMD ["node", "server.js"]

