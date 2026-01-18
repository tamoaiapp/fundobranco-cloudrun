FROM python:3.11-slim

# libs que o rembg costuma precisar (e evita erro do opencv / pillow)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# cria venv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# se for FastAPI:
# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

# se for Flask/Express-like python:
CMD ["python", "server.py"]
