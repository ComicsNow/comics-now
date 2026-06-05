# Build stage
FROM node:20-bookworm AS builder

# Install system dependencies for building native modules and comictagger
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js dependencies (including devDependencies for Vite)
COPY package*.json ./
COPY scripts/check-dependencies.js ./scripts/
RUN npm ci

# Copy the application source code and compile Vite assets
COPY . .
RUN npm run build

# Prune development dependencies to keep the image lightweight
RUN npm prune --omit=dev

# Install ComicTagger in a virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir comictagger

# Runtime stage
FROM node:20-bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    libvips42 \
    libgomp1 \
    unrar-free \
    zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy application source, compiled Vite assets, production node_modules, and venv
COPY --chown=node:node . .
COPY --from=builder --chown=node:node /app/public/dist ./public/dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /opt/venv /opt/venv

# Setup environment
ENV PATH="/opt/venv/bin:$PATH"
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Create data directory and set permissions
RUN mkdir -p /app/data && chown 1000:1000 /app/data
USER node

# Expose the default port
EXPOSE 3000

CMD ["npm", "start"]
