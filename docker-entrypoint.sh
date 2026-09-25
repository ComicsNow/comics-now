#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"

# If running as root, ensure data directory exists and has node ownership, then run command as node user
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su node -c "$*"
fi

exec "$@"
