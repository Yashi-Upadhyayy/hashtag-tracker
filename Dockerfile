FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY tests ./tests
RUN npm run build

FROM build AS test
CMD ["npm", "test"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
RUN mkdir -p /data/assets && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/src/entrypoints/api.js"]
