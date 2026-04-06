FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Hugging Face Spaces dynamically assigns a port, but 7860 is the default
EXPOSE 7860

# Override the port with 7860 for HF compatibility
ENV PORT=7860

CMD [ "node", "index.js" ]
