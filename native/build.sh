#!/bin/sh
# Builds the WebAssembly module and the native reference harness from the same sources.
# Runs inside the pinned image (see scripts/build.mjs):  emscripten/emsdk:4.0.10
#   emcc 4.0.10 (b7dc6e5747465580df5984e723b9d1f10d8e804b), g++ 11.4.0
# LIBRARY_NAME/VERSION are what NTIA's CMake defines for P.2108 v1.1.
# No -ffast-math anywhere: results must stay IEEE-754 reproducible (plan 16.1).
set -eu
cd "$(dirname "$0")/.."

SRC="native/bridge.cpp third_party/ntia-itm/src/*.cpp third_party/ntia-p2108/src/*.cpp"
FLAGS="-Ithird_party/ntia-p2108/include -O2 -std=c++17 -fno-fast-math -ffp-contract=off"

mkdir -p wasm build
# shellcheck disable=SC2086
emcc $FLAGS '-DLIBRARY_NAME="P2108"' '-DLIBRARY_VERSION="1.1"' $SRC -o wasm/rflp-engine.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 -sASSERTIONS=0 \
  -sEXPORTED_FUNCTIONS=_rflp_itm_p2p,_rflp_find_horizons,_rflp_p2108_hgtc,_rflp_p2108_tsm,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPF64

# shellcheck disable=SC2086
g++ $FLAGS '-DLIBRARY_NAME="P2108"' '-DLIBRARY_VERSION="1.1"' $SRC native/harness.cpp -o build/harness

echo "emcc: $(emcc --version | head -1)" > wasm/BUILD_INFO.txt
echo "g++: $(g++ --version | head -1)" >> wasm/BUILD_INFO.txt
sha256sum wasm/rflp-engine.wasm >> wasm/BUILD_INFO.txt
cat wasm/BUILD_INFO.txt
