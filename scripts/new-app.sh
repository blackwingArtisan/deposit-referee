#!/usr/bin/env bash
# Create a new hackathon app from the kit.
#
#   scripts/new-app.sh <slug> "<Display Name>" <brand-hex> [--no-install]
#   scripts/new-app.sh refund-copilot "Refund Copilot" "#7c3aed"
#
# Copies the kit (without node_modules, build output, local data, videos or git history) to
# ../apps/<slug>, sets the name, slug and brand colour, turns README.template.md into README.md,
# runs `npm ci` (exact versions from the lockfile) and makes the first git commit.
#
# Git identity: the machine's identity can carry a real name and hostname, so it is never used.
# Commits go out as the identity below, set in the app's local git config. Override with
# APP_GIT_NAME and APP_GIT_EMAIL.
set -euo pipefail

GIT_NAME="${APP_GIT_NAME:-blackwingArtisan}"
GIT_EMAIL="${APP_GIT_EMAIL:-23040179+blackwingArtisan@users.noreply.github.com}"

usage() {
  echo "Usage: $0 <slug> \"<Display Name>\" <brand-hex> [--no-install]" >&2
  echo "  slug: lowercase letters, digits, dashes (e.g. refund-copilot)" >&2
  echo "  brand-hex: e.g. \"#7c3aed\"" >&2
  exit 1
}

[ $# -ge 3 ] || usage
SLUG="$1"
NAME="$2"
HEX="$3"
INSTALL=1
[ "${4:-}" = "--no-install" ] && INSTALL=0

[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,48}$ ]] || { echo "Invalid slug: $SLUG" >&2; usage; }
[ -n "$NAME" ] || { echo "Display name is required" >&2; usage; }
HEX="#${HEX#\#}"
[[ "$HEX" =~ ^#[0-9a-fA-F]{6}$ ]] || { echo "Invalid brand colour: $3 (use 6-digit hex like #7c3aed)" >&2; usage; }

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$KIT_DIR/.." && pwd)"
DEST="$ROOT/apps/$SLUG"
[ -e "$DEST" ] && { echo "Already exists: $DEST" >&2; exit 1; }
mkdir -p "$ROOT/apps"

echo "→ Copying kit to $DEST"
rsync -a \
  --exclude node_modules --exclude '.next' --exclude '.next-*' --exclude '.data' --exclude '.data-*' \
  --exclude test-results --exclude playwright-report --exclude screenshots --exclude 'videos/*.webm' --exclude 'videos/*.mp4' \
  --exclude .git --exclude next-env.d.ts --exclude '*.tsbuildinfo' --exclude '.env' --exclude '.env.local' \
  --exclude '.env.shared' --exclude .DS_Store \
  "$KIT_DIR/" "$DEST/"

KIT_SHA="$(git -C "$KIT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "→ Setting name, slug and brand colour"
APP_NAME="$NAME" APP_SLUG="$SLUG" APP_HEX="$HEX" KIT_SHA="$KIT_SHA" node - "$DEST" <<'NODE'
const fs = require("fs");
const path = require("path");
const dest = process.argv[2];
const { APP_NAME: name, APP_SLUG: slug, APP_HEX: hex, KIT_SHA: sha } = process.env;

// Readable text colour on the brand colour (WCAG relative luminance).
const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
const fg = lum > 0.42 ? "#111111" : "#FFFFFF";

const edit = (file, fn) => {
  const p = path.join(dest, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
};
const q = (s) => JSON.stringify(s);

edit("src/app.config.ts", (s) =>
  s
    .replace(/^(\s*)name: .*\/\/ kit:name$/m, `$1name: ${q(name)}, // kit:name`)
    .replace(/^(\s*)slug: .*\/\/ kit:slug$/m, `$1slug: ${q(slug)}, // kit:slug`)
    .replace(/^(\s*)brandColor: .*\/\/ kit:brand$/m, `$1brandColor: ${q(hex)}, // kit:brand`)
    .replace(/^(\s*)brandForeground: .*\/\/ kit:brand-foreground$/m, `$1brandForeground: ${q(fg)}, // kit:brand-foreground`),
);
edit("src/app/globals.css", (s) => s.replace(/--brand: #[0-9a-fA-F]{6};/, `--brand: ${hex};`).replace(/--brand-foreground: #[0-9a-fA-F]{6};/, `--brand-foreground: ${fg};`));
edit("package.json", (s) => {
  const p = JSON.parse(s);
  p.name = slug;
  return JSON.stringify(p, null, 2) + "\n";
});
edit("package-lock.json", (s) => {
  const p = JSON.parse(s);
  p.name = slug;
  if (p.packages && p.packages[""]) p.packages[""].name = slug;
  return JSON.stringify(p, null, 2) + "\n";
});
edit("render.yaml", (s) => s.replace(/name: paypal-agent-kit/, `name: ${slug}`));
edit("LICENSE", (s) => s.replace("PayPal Agent Kit contributors", `${name} contributors`));

const tpl = fs.readFileSync(path.join(dest, "README.template.md"), "utf8");
fs.writeFileSync(path.join(dest, "README.md"), tpl.replaceAll("{{APP_NAME}}", name).replaceAll("{{SLUG}}", slug));
fs.rmSync(path.join(dest, "README.template.md"));
fs.writeFileSync(path.join(dest, ".kit-version"), `${sha}\n`);

const check = fs.readFileSync(path.join(dest, "src/app.config.ts"), "utf8");
if (!check.includes(q(name)) || !check.includes(q(hex))) {
  console.error("Failed to update src/app.config.ts markers");
  process.exit(1);
}
console.log(`  name=${name} slug=${slug} brand=${hex} text-on-brand=${fg}`);
NODE

cd "$DEST"
if [ "$INSTALL" = 1 ]; then
  echo "→ Installing dependencies (npm ci, exact versions from package-lock.json)"
  npm ci --prefer-offline --no-audit --no-fund --loglevel=error
fi

echo "→ git init + first commit"
git init -q
git config user.name "$GIT_NAME"
git config user.email "$GIT_EMAIL"
git add -A
GIT_AUTHOR_NAME="$GIT_NAME" GIT_AUTHOR_EMAIL="$GIT_EMAIL" GIT_COMMITTER_NAME="$GIT_NAME" GIT_COMMITTER_EMAIL="$GIT_EMAIL" \
  git commit -q -m "Initial commit: $NAME from PayPal Agent Kit ($KIT_SHA)"

cat <<EOF

✓ Created $DEST

Next:
  cd apps/$SLUG
  $( [ "$INSTALL" = 0 ] && echo "npm ci                      # install exact versions" )
  PAYPAL_MODE=mock npm run dev   # or omit PAYPAL_MODE to use ../../.env.shared
  open http://localhost:3000

Then read KIT-GUIDE.md (quality checklist at the end) and CLAUDE.md.
EOF
