FROM node:20-bookworm-slim

# Python + venv + deps que evitam erro de libs (Pillow/OpenCV)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package*.json ./
RUN npm ci --omit=dev

# VENV (evita PEP 668)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
