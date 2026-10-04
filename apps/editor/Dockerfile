# AlgoLiquid Studio web editor (Next.js standalone server).
# Build from the repository root (NEXT_PUBLIC_* are baked in at build time):
#   docker build -f apps/editor/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.studio.algo-liquid.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://studio.algo-liquid.com \
#     -t algoliquid-studio-web .
FROM node:22-alpine AS build
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    TRADEANIM_SKIP_PYTHON=1
COPY package.json package-lock.json ./
COPY apps/editor/package.json apps/editor/package.json
COPY packages/editor-core/package.json packages/editor-core/package.json
COPY packages/project-schema/package.json packages/project-schema/package.json
COPY scripts scripts
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/editor apps/editor
RUN npm run build -w @tradeanim/editor

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/editor/.next/standalone ./
COPY --from=build /repo/apps/editor/.next/static ./apps/editor/.next/static
COPY --from=build /repo/apps/editor/public ./apps/editor/public
USER node
EXPOSE 3000
CMD ["node", "apps/editor/server.js"]
