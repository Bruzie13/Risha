FROM node:22-slim

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY src/ ./src/
COPY database/ ./database/

EXPOSE 8000

CMD ["node", "backend/server.js"]
