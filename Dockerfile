# Use a Node.js base image (choose a version that matches your Node.js version, e.g., 20)
FROM node:20-slim

# Set the working directory
WORKDIR /app/server

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies (this environment *will* have the tools to build tokenizers)
# Using 'npm ci' for production builds as it's more deterministic based on package-lock.json
RUN npm ci

# Copy the rest of your application code (including models directory)
COPY . .

# Expose the port your app listens on
EXPOSE 5000

# Start your application
CMD ["node", "index.js"]