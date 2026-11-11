# Sunset Sideways: Spiel + Admin-Bereich in einem Container (Node ≥ 24.7 wegen node:sqlite und Argon2id)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/sunset.db TRUST_PROXY=1
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-admin ./dist-admin
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist-server/index.mjs"]
