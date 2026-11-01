FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY admin.mjs admin.html admin-ui.js ./
COPY portal-server.mjs ./
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
