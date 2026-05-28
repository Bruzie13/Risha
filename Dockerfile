FROM nikolaik/python-nodejs:python3.12-nodejs22

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY ml-service/requirements.txt ./ml-service/
RUN cd ml-service && pip install -r requirements.txt

COPY . .

EXPOSE 8000
EXPOSE 5002

CMD cd ml-service && gunicorn -w 2 -b 0.0.0.0:5002 app:app & sleep 3 && cd ../backend && node server.js
