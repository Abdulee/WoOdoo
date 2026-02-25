FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy backend code
COPY backend/ /app/backend/

# Install Python dependencies from pyproject.toml
RUN pip install --no-cache-dir -e /app/backend

# Expose port
EXPOSE 8000

# Default command (can be overridden)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
