FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
# Cloud Run sets PORT (8080); server.js reads it.
CMD ["node", "server.js"]
