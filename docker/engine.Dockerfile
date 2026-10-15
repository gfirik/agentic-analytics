# Engine image skeleton (M0). Bun installs dependencies (D14); Node 22 is the runtime (D7).
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
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
# `aa serve` lands in M10; until then the container runs the doctor and exits.
CMD ["node", "apps/cli/bin/aa.js", "doctor"]
