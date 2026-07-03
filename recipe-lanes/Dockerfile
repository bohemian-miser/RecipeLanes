# Cloud Run preview image for RecipeLanes.
# Build context is `recipe-lanes/`. The workflow copies
# functions/src/vector-search/data/icon_index.json into place before build;
# prebuild.js tolerates its absence (writes an empty index).
#
# Single-stage build: `next build` produces a default (.next) build and we run
# it with `next start`. onnxruntime-node is aliased to onnxruntime-web (WASM) in
# next.config.ts, so no native .so is needed at runtime.
FROM node:20-slim

# sharp ships prebuilt binaries for linux-x64 glibc, so no extra OS deps are
# required on node:20-slim (Debian glibc). Add libc6/openssl only if a future
# sharp/onnx native path needs them.

ENV NODE_ENV=production

# --- Build-time public Firebase config (inlined by `next build`) ---
# These MUST be present at build time because Next.js inlines NEXT_PUBLIC_* vars.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_ENV_NAME=preview

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_ENV_NAME=$NEXT_PUBLIC_ENV_NAME

WORKDIR /app

# Install deps first for layer caching. --include=dev is required because
# NODE_ENV=production would otherwise make npm omit devDependencies, and
# next build needs them (next, typescript, tailwind, etc).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# App source (build context is recipe-lanes/; see .dockerignore).
COPY . .

# prebuild.js downloads Xenova/all-MiniLM-L6-v2 into model-cache/ (needs network)
# and copies icon_index.json; then next build. MOCK_AI is never set here.
RUN npm run build

# Cloud Run injects PORT (default 8080). Do NOT hardcode 8001.
ENV PORT=8080
EXPOSE 8080

# Mirror scripts/start.sh: add onnxruntime-node's bundled lib dir to
# LD_LIBRARY_PATH (harmless with the WASM alias) and start on $PORT.
CMD ["sh", "-c", "ONNX_BIN_DIR=$(node -e \"try{const p=require('path');const pkg=require.resolve('onnxruntime-node/package.json');const d=p.join(p.dirname(pkg),'bin','napi-v6','linux','x64');const fs=require('fs');if(fs.existsSync(d))process.stdout.write(d);}catch(e){}\" 2>/dev/null); if [ -n \"$ONNX_BIN_DIR\" ]; then export LD_LIBRARY_PATH=\"${ONNX_BIN_DIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\"; fi; exec npx next start -p ${PORT:-8080}"]
