#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?Falta VERCEL_TOKEN}"
: "${VERCEL_ORG_ID:?Falta VERCEL_ORG_ID}"

ROOT=$(git rev-parse --show-toplevel)
PROJECT_FILE="$ROOT/.vercel/project.json"

if [[ ! -f "$PROJECT_FILE" ]]; then
  echo "Falta .vercel/project.json." >&2
  exit 2
fi

TEAM_SLUG=$(
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v2/teams/$VERCEL_ORG_ID" |
    node -e '
      let data = "";
      process.stdin.on("data", chunk => data += chunk);
      process.stdin.on("end", () => {
        const team = JSON.parse(data);
        if (!team.slug) process.exit(2);
        process.stdout.write(team.slug);
      });
    '
)

DEPLOY_DIR=$(mktemp -d "${TMPDIR:-/tmp}/vercel-head-XXXXXX")
trap 'rm -rf "$DEPLOY_DIR"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/.vercel"
cp "$PROJECT_FILE" "$DEPLOY_DIR/.vercel/project.json"

cd "$DEPLOY_DIR"
npx --yes vercel@latest deploy \
  --prod \
  --yes \
  --archive=tgz \
  --scope "$TEAM_SLUG" \
  --token="$VERCEL_TOKEN"
