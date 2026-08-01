# Multi-stage build for NestJS backend
FROM node:20-alpine AS builder

WORKDIR /app

# Install app dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy dependencies and build output from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Expose port (adjust if your backend uses a different port)
EXPOSE 3000

# Start the application
CMD [ "npm", "run", "start:prod" ]
