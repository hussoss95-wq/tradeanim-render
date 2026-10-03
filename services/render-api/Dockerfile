# AlgoLiquid Studio render API (FastAPI + tradeanim + FFmpeg).
# Build from the repository root:
#   docker build -f services/render-api/Dockerfile -t algoliquid-render-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    APP_ENV=production \
    WORKSPACE_DIR=/data \
    PORT=8000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt setup.py ./
COPY services/render-api/requirements.txt services/render-api/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r services/render-api/requirements.txt

COPY tradeanim tradeanim
COPY services/render-api services/render-api
RUN pip install --no-cache-dir -e . \
 && useradd --create-home --uid 10001 app \
 && mkdir -p /data && chown app /data
USER app

VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health',timeout=4)"
CMD ["sh", "services/render-api/start.sh"]
