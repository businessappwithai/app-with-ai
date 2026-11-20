#!/usr/bin/env bash
# Push current main into the deploy branch.
# Usage: ./scripts/push-deploy.sh [remote]
set -euo pipefail

REMOTE="${1:-origin}"
CURRENT=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT" != "main" ]]; then
  echo "ERROR: must be on main (currently on $CURRENT)" >&2
  exit 1
fi

git fetch "$REMOTE"
git push "$REMOTE" "main:deploy" --force-with-lease
echo "Pushed main → deploy on $REMOTE"
