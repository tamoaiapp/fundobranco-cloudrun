# Base leve e compatível com onnxruntime
FROM node:22-slim

# Dependências do Python (Pillow/onnx/rembg) + certificados
RUN apt-get update && apt-get install -y \
  python3 python3-pip python3-venv \
  libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala deps Node primeiro (cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o resto
COPY . .

# VENV python + rembg com backend CPU (instala onnxruntime junto)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir "rembg[cpu]" pillow

# Cloud Run
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
