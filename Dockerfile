# Stage 1: Build Frontend
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and install all dependencies (including devDependencies)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the Vite frontend
RUN npm run build

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy package.json and install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy the built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy the backend source and config
COPY tsconfig.json ./
COPY server.ts ./
COPY server/ ./server/

# Ensure data and certs directories exist
RUN mkdir -p data certs && chown -R node:node data certs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Use a non-root user
USER node

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
