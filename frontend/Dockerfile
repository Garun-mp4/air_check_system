FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci

FROM node:22-alpine AS owner-tools

WORKDIR /app
COPY owner-tools/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node scripts/manage-owner.mjs ./scripts/manage-owner.mjs
USER node
ENTRYPOINT ["node", "scripts/manage-owner.mjs"]

FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/scripts ./scripts
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]

