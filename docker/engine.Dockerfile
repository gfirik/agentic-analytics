# Engine image. Bun installs dependencies (D14); Node 22 is the runtime (D7). Runs `aa serve` (API, viewer, MCP).
FROM oven/bun:1.4.3 AS bun

FROM node:22-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY evals ./evals
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --filter @agentic-analytics/viewer build
ENV DATA_DIR=/data
ENV AA_JOBS_DIR=/data/jobs
VOLUME ["/data"]
EXPOSE 8080
# Inside the container the API listens on all interfaces; compose publishes it on the host's localhost only.
# 0.0.0.0 inside the container; docker-compose publishes the port on the host's 127.0.0.1 only. Set API_TOKEN
# before publishing it anywhere else.
CMD ["node", "apps/cli/bin/aa.js", "serve", "--host", "0.0.0.0", "--port", "8080", "--allow-no-auth"]
