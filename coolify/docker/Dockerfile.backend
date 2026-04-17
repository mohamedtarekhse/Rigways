# Node.js Backend
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY backend/ ./

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "src/server.js"]
