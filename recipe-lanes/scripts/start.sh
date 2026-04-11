#!/bin/bash
# Wrapper for `next start` that adds onnxruntime-node's bundled shared library
# to LD_LIBRARY_PATH before the process starts.
#
# Cloud Run containers don't always resolve $ORIGIN RUNPATH entries correctly,
# so libonnxruntime.so.1 (which sits next to onnxruntime_binding.node) can't be
# found by dlopen even though it's physically present in the npm package.
# Explicitly adding its directory to LD_LIBRARY_PATH fixes this.

ONNX_BIN_DIR=$(node -e "
try {
  const path = require('path');
  const pkg = require.resolve('onnxruntime-node/package.json');
  const dir = path.join(path.dirname(pkg), 'bin', 'napi-v6', 'linux', 'x64');
  const fs = require('fs');
  if (fs.existsSync(dir)) process.stdout.write(dir);
} catch (e) {}
" 2>/dev/null)

if [ -n "$ONNX_BIN_DIR" ]; then
    echo "[start.sh] Setting LD_LIBRARY_PATH to include $ONNX_BIN_DIR"
    export LD_LIBRARY_PATH="${ONNX_BIN_DIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec next start -p 8001
