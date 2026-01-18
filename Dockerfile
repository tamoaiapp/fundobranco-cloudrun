FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir rembg pillow

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY index.js .
COPY bg_remove.py .

ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
