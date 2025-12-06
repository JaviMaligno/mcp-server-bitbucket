FROM python:3.11-slim

WORKDIR /app

# Install poetry
RUN pip install poetry

# Copy dependency files and README
COPY pyproject.toml README.md ./

# Install dependencies (without dev dependencies, without installing the project itself)
RUN poetry config virtualenvs.create false && \
    poetry install --no-interaction --no-ansi --only main --no-root

# Copy source code
COPY src/ ./src/

# Set environment variables
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 8080

# Run HTTP server
CMD ["uvicorn", "src.http_server:app", "--host", "0.0.0.0", "--port", "8080"]
