FROM node:22-bookworm-slim

# Python + pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install --omit=dev

# Python deps (rembg[cpu] -> onnxruntime)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# App files
COPY index.js bg_remove.py ./

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
