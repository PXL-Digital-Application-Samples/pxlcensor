FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

RUN mkdir -p /media && \
    chown -R nodejs:nodejs /media

USER nodejs

EXPOSE 8081

CMD ["node", "server.js"]