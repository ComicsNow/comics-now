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

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --omit=dev

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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules and built assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /opt/venv /opt/venv
COPY . .

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
