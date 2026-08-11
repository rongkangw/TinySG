FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
RUN mkdir -p data && chown appuser:appuser data
COPY --chown=appuser:appuser backend/ backend/
COPY --chown=appuser:appuser config/ config/
COPY --chown=appuser:appuser output/*.json output/
COPY --chown=appuser:appuser data/TrafficIncidents.json data/TrafficIncidents.json
COPY --from=frontend-build --chown=appuser:appuser \
    /build/frontend/dist frontend/dist

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
