# ---- Stage: base image ----
# python:3.11-slim is a minimal Debian image with Python pre-installed.
# "slim" means no compilers or build tools — keeps the image small (~60MB
# base), which matters because every replica downloads this image.
FROM python:3.11-slim

# Set the working directory inside the container.
# All subsequent COPY and RUN commands are relative to /app.
WORKDIR /app

# Copy requirements FIRST, before copying the rest of the code.
# Why? Docker builds in layers. If requirements.txt hasn't changed, Docker
# reuses the cached pip-install layer and skips re-downloading packages.
# Only code changes trigger a full rebuild of the app layer.
COPY requirements.txt .

# Install dependencies.
# --no-cache-dir: Don't store pip's download cache inside the image layer.
#   (The build-time cache lives on D:\ via Docker's WSL disk — separate concern.)
RUN pip install --no-cache-dir -r requirements.txt

# Now copy the application code.
COPY main.py .

# Document that the container listens on port 8000.
# This does NOT actually publish the port — that happens in the K8s Service.
EXPOSE 8000

# Start the uvicorn ASGI server.
# --host 0.0.0.0  → listen on all interfaces inside the container
#                   (not just 127.0.0.1 which would be unreachable from outside)
# --port 8000     → match the EXPOSE above
# --workers 1     → one worker process per pod.
#                   We run 3 pods for concurrency, not 3 workers in one pod.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
