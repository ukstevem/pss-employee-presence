#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io/ukstevem/pss-employee-presence"
PLATFORM="linux/arm64"
SHARED_ENV="../platform-portal/.env"

[ -f "$SHARED_ENV" ] || { echo "Missing $SHARED_ENV — sibling layout required." >&2; exit 1; }
set -a; source "$SHARED_ENV"; set +a

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"

docker buildx inspect multiarch >/dev/null 2>&1 || \
  docker buildx create --name multiarch --use
docker buildx use multiarch

docker buildx build \
  --platform "$PLATFORM" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  --build-arg NEXT_PUBLIC_DOC_GATEWAY_BASE_URL="${NEXT_PUBLIC_DOC_GATEWAY_BASE_URL:-}" \
  --build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-}" \
  --build-arg NEXT_PUBLIC_DOC_SERVICE_URL="${NEXT_PUBLIC_DOC_SERVICE_URL:-}" \
  -t "$REGISTRY:$SHA" \
  -t "$REGISTRY:latest" \
  --push \
  ./app

echo "Pushed $REGISTRY:$SHA and $REGISTRY:latest"
