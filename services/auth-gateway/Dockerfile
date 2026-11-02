FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs logs.mjs log-fields.mjs log-store.mjs log-db.mjs legacy-logs.mjs monitor.mjs ./
COPY tts.mjs ./
COPY admin.mjs admin.html admin-ui.js ./
COPY portal-server.mjs ./
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
