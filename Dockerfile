FROM node:22-slim

# The demand forecasting model runs on Python + scikit-learn (see ml/forecast.py);
# Node serves the API and calls into it. Both runtimes have to exist in the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first so this layer caches independently of application code.
COPY ml/requirements.txt ./ml/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r ml/requirements.txt

# Node finds the interpreter through PYTHON_BIN (see backend/utils/mlForecast.js).
ENV PYTHON_BIN=/opt/venv/bin/python3

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY src/ ./src/
COPY database/ ./database/
COPY ml/ ./ml/
COPY scripts/ ./scripts/

# Fail the build rather than ship an image whose model silently falls back to
# the statistical baseline.
RUN echo '{"days":1,"jobs":[]}' | /opt/venv/bin/python3 ml/forecast.py > /dev/null

EXPOSE 8000

CMD ["node", "backend/server.js"]
