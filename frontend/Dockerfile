# Multi-stage build for Angular frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build -- --configuration production

# Production stage using Nginx
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Copy custom Nginx configuration if needed (optional)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Add a simple fallback for Angular routing
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
