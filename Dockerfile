# syntax=docker/dockerfile:1

# Stage 1: install dependencies
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS deps
WORKDIR /app

# Install pnpm with npm at the version package.json names in packageManager,
# so the image installs with the same pnpm, and the same policies, as a
# checkout does.
RUN npm install -g pnpm@11.25.0

# pnpm-workspace.yaml carries the dependency overrides since pnpm 10 moved
# them out of package.json. Without it a frozen install fails the lockfile
# config check, because the recorded overrides have nothing to match.
# scripts/ comes with the manifests because package.json's `prepare` runs
# scripts/setup-hooks.mjs, and pnpm runs `prepare` on every install. Without the
# file the install exits 1 with "Cannot find module". The script itself is happy
# here: it exits 0 the moment it finds no git checkout, which is exactly what a
# build context is.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

# Stage 2: build
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder
WORKDIR /app

RUN npm install -g pnpm@11.25.0

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The visual editors are a separate package under a commercial license. The
# seam in src/lib/canvas/ builds them in when they sit at the mount path and
# builds the list editors when they do not. The official image passes
# REQUIRE_EDITORS=1, which refuses to build without them, so a release whose
# fetch went wrong fails here instead of shipping the other build. Their
# license travels into the image beside this repository's own.
ARG REQUIRE_EDITORS=0
RUN editors=src/lib/canvas/editors; \
    if [ "$REQUIRE_EDITORS" = "1" ]; then \
      for f in flow/FlowCanvas.svelte schema/SchemaCanvas.svelte LICENSE.md; do \
        test -f "$editors/$f" || { echo "REQUIRE_EDITORS=1, and $editors/$f is missing" >&2; exit 1; }; \
      done; \
    fi; \
    if [ -f "$editors/LICENSE.md" ]; then cp "$editors/LICENSE.md" LICENSE-COMMERCIAL.md; fi

# ORIGIN must match the public URL so SvelteKit can generate correct links.
# It is overridable at runtime via the ORIGIN env var.
ENV NODE_ENV=production

RUN pnpm run build
# Strip any source maps from the build output so original source is never
# shipped in the production image. Client maps are already disabled through
# vite build.sourcemap=false, and this also removes the server-side maps.
RUN find build -name '*.map' -delete
# The runtime stage has no node_modules, so a package the server imports and
# the bundle left outside would fail the first request that loads it. Refuse
# to build that image.
RUN node tools/check-server-bundle.mjs build

# Stage 3: the node binary without its symbol tables
# The base image's node carries 24 MB of symbol tables that only a native
# profiler reads. JavaScript stack traces do not use them, and the dynamic
# symbols an addon links against stay. The strip tools stay in this stage.
# node:26.12.1-alpine
FROM node@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS node-stripped
RUN apk add --no-cache binutils \
 && strip /usr/local/bin/node

# Stage 4: the runtime's root filesystem
# The Node base image ships npm and npx in its own layers, and
# deleting them in a layer above leaves their bytes in the image under
# whiteouts, where a scanner that reads each layer still finds them. The
# runtime is plain Alpine of the same release instead, with the node binary,
# the libraries it links and the base image's node user and entrypoint, and
# its packages upgraded to the release's current fixes.
# alpine:3.24
FROM alpine@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime-root
RUN apk upgrade --no-cache \
 && apk add --no-cache libatomic libstdc++ \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=node-stripped /usr/local/bin/node /usr/local/bin/docker-entrypoint.sh /usr/local/bin/

# Stage 5: runtime
# One layer holds the whole root filesystem, so the base packages the upgrade
# replaced leave nothing behind either.
FROM scratch AS runtime
COPY --from=runtime-root / /
WORKDIR /app

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV NODE_ENV=production
# adapter-node honors PORT and ORIGIN at runtime.
ENV PORT=3002
# adapter-node refuses a request body past 512K unless told otherwise, which
# is below what the console posts on purpose: a configuration bundle the
# engine takes up to 8 MiB, and a schema import of up to 4 MB. 10M fits the
# largest with room for the form's other fields and its encoding.
ENV BODY_SIZE_LIMIT=10M

COPY --from=builder /app/build         ./build
COPY --from=builder /app/package.json  ./package.json
COPY --from=builder /app/LICENSE*      ./

# Only the built output, package.json and the license files are needed, with
# no node_modules at runtime. That holds only while every package the server
# imports is bundled into build/, which the builder stage checks.

EXPOSE 3002

USER node

# 127.0.0.1, not localhost: adapter-node binds IPv4 only, and localhost
# resolves to ::1 first in this image, so the probe would be refused while the
# server is serving. /readyz answers 503 while the engine cannot be reached,
# which the root page does not: it answers 200 either way.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3002/readyz || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "build/index.js"]
