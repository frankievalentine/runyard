# Runyard from a release build (`vp run release`), with the ssh client and the
# Tailscale CLI. tailscaled runs in the sidecar (see compose.yaml); Runyard
# reaches it through the shared socket and serves HTTPS on its tailnet address.
#
#   docker build -f docker/Dockerfile -t runyard .
FROM tailscale/tailscale:v1.104.2 AS tailscale

FROM debian:bookworm-slim
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
# Mounted rather than copied, so the other architecture's binary never lands in a layer.
RUN --mount=type=bind,source=apps/cli/dist/release,target=/release set -eu; \
  case "$TARGETARCH" in amd64) target=linux-x64 ;; arm64) target=linux-arm64 ;; *) echo "no build for $TARGETARCH" >&2; exit 1 ;; esac; \
  cd /release; \
  file="runyard-$(tr -d '[:space:]' < VERSION)-$target"; \
  grep "  $file\$" SHA256SUMS | sha256sum -c -; \
  install -m 755 "$file" /usr/local/bin/runyard
COPY docker/entrypoint.sh /usr/local/bin/runyard-entrypoint
RUN chmod 755 /usr/local/bin/runyard-entrypoint

# Runs as root: `tailscale cert` through the sidecar's socket needs root or the
# Tailscale operator, and the sidecar can't name a user from this container.
ENV RUNYARD_DATA_DIR=/data \
  RUNYARD_SSH=/usr/bin/ssh \
  RUNYARD_TAILSCALE=/usr/local/bin/tailscale
VOLUME /data
# Loopback inside the container (or the Tailscale sidecar's network it shares).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${RUNYARD_PORT:-7420}/api/health" >/dev/null || exit 1
ENTRYPOINT ["runyard-entrypoint"]
CMD ["runyard"]
