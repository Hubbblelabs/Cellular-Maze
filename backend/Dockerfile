# Build from the repository root (the backend imports the sibling `model` package):
#   docker build -f backend/Dockerfile -t cellularmaze-backend .
FROM python:3.12-slim

WORKDIR /app

# CPU-only PyTorch keeps the image ~1 GB smaller than the default CUDA build
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY model/ model/

EXPOSE 8000

# backend.main is the full API (/api/*, /model/*, /api/v1/*)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
