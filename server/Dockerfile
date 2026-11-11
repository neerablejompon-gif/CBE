# CBE Reporting on an organisation server: the same mockup/_worker.js, run by Node.js
FROM node:22-alpine
WORKDIR /app
COPY mockup/index.html mockup/privacy.html mockup/_worker.js ./mockup/
COPY mockup/assets ./mockup/assets
COPY server/index.mjs ./server/
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/privacy.html >/dev/null || exit 1
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/index.mjs"]
