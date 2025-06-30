# Use a Node.js base image (choose a version that matches your Node.js version, e.g., 20 or 22)
FROM node:20-slim

# Install system dependencies needed for Rust and Node.js native modules
# 'curl' for rustup, 'build-essential' for C/C++ compilers, 'python3' for some build scripts
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain
# This is a standard way to install Rust. It adds ~/.cargo/bin to PATH.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    --default-toolchain stable

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies (npm ci is preferred for production builds with lock files)
# Now npm ci will have the Rust compiler available for tokenizers
RUN npm ci

# Copy the rest of your application code (including your 'models' directory)
COPY . .

# Expose the port your app listens on
EXPOSE 5000

# Command to run your application
CMD ["node", "index.js"]