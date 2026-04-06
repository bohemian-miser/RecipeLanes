#!/bin/bash
# Setup script for the Embedding Minigame project

set -e

echo "=== Setup Embedding Minigame Environment ==="

# 1. Install Node Dependencies
echo "--> Installing Node.js dependencies..."
npm install

# 2. Dump Database to JSON for Rust Backend
echo "--> Syncing Firestore 'icon_index_browser' (384d vectors) locally for Rust Backend..."
if [ ! -f "staging-service-account.json" ]; then
    echo "[WARNING] 'staging-service-account.json' not found in the minigames folder!"
    echo "          The Next.js and Node scripts require this to access Firestore."
    echo "          Please copy it from the main project and re-run this script."
    exit 1
else
    npx tsx scripts/dump-db.ts
fi

# 3. Download ONNX Models for Rust Backend
echo "--> Downloading local 'all-MiniLM-L6-v2' ONNX model for Rust server..."
MODEL_DIR="rust-embed/models/all-MiniLM-L6-v2"
mkdir -p "$MODEL_DIR"
cd "$MODEL_DIR"

if [ ! -f "tokenizer.json" ]; then
    echo "    Downloading tokenizer.json..."
    curl -sLO https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json
fi

if [ ! -f "config.json" ]; then
    echo "    Downloading config.json..."
    curl -sLO https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json
fi

if [ ! -f "special_tokens_map.json" ]; then
    echo "    Downloading special_tokens_map.json..."
    curl -sLO https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/special_tokens_map.json
fi

if [ ! -f "tokenizer_config.json" ]; then
    echo "    Downloading tokenizer_config.json..."
    curl -sLO https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json
fi

if [ ! -f "model.onnx" ]; then
    echo "    Downloading model.onnx (86MB)..."
    curl -sLO https://huggingface.co/Qdrant/all-MiniLM-L6-v2-onnx/resolve/main/model.onnx
fi

cd ../../../ # Return to minigames root

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "You can now run both servers side-by-side:"
echo ""
echo "Terminal 1 (Next.js UI):"
echo "  npm run dev"
echo ""
echo "Terminal 2 (Rust In-Memory Vector Search):"
echo "  cd rust-embed && cargo run --release"
echo ""
