FROM nikolaik/python-nodejs:python3.12-nodejs22

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY ml-service/requirements.txt ./ml-service/
RUN cd ml-service && pip install -r requirements.txt --quiet

COPY backend/ ./backend/
COPY ml-service/ ./ml-service/
COPY src/ ./src/
COPY database/ ./database/

EXPOSE 8000

CMD cd /app/backend && node server.js
