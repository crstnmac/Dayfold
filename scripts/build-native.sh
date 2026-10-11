#!/usr/bin/env bash
# Builds the Swift accessibility helper as a universal (arm64 + x86_64) binary into resources/bin.
set -euo pipefail
cd "$(dirname "$0")/.."
out=resources/bin
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macosx12.0" native/ax-tracker.swift -o "$tmp/ax-tracker-$arch"
done
lipo -create "$tmp/ax-tracker-arm64" "$tmp/ax-tracker-x86_64" -output "$out/ax-tracker"
chmod 755 "$out/ax-tracker"
lipo -info "$out/ax-tracker"
