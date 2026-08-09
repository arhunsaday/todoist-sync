#!/bin/sh
set -e

# Platform volumes (Railway, plain `docker run -v`, fly) are mounted owned by
# root, after the image is built — so nothing done at build time can fix their
# ownership. A container that starts as a non-root user therefore cannot write
# to its own volume.
#
# Rather than require a platform-specific escape hatch (Railway's answer is
# RAILWAY_RUN_UID=0, i.e. "run everything as root"), take ownership of just the
# database directory while we still have the privileges to do it, then drop to
# the unprivileged `node` user for the actual process.
#
# If we are already non-root there is nothing to fix; run as-is and let the
# database layer report a clear error if the directory really is unwritable.

DB_PATH="${DATABASE_PATH:-/data/sync.db}"
DB_DIR=$(dirname "$DB_PATH")

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DB_DIR"
  chown -R node:node "$DB_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
