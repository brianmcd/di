#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo "=== Running typecheck ==="
pnpm run typecheck

echo ""
echo "=== Running eslint ==="
pnpm run lint

echo ""
echo "=== Running prettier check ==="
pnpm run format:check

echo ""
echo "=== Running tests ==="
pnpm run test

echo ""
echo "=== All checks passed ==="
