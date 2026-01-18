FROM node:20-slim

# dependências de sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# cria venv para o rembg
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# instala rembg dentro do venv
RUN pip install --no-cache-dir rembg pillow

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY index.js .
COPY bg_remove.py .

ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
