# Identifica o gerenciador de pacotes do projeto e o cache correspondente.
set -euo pipefail

manager="npm"

if [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
  manager="bun"
elif [ -f "pnpm-lock.yaml" ]; then
  manager="pnpm"
elif [ -f "yarn.lock" ]; then
  manager="yarn"
elif [ -f "package-lock.json" ]; then
  manager="npm"
elif grep -qE '"packageManager"[[:space:]]*:[[:space:]]*"bun@' package.json 2>/dev/null; then
  manager="bun"
elif grep -qE '"packageManager"[[:space:]]*:[[:space:]]*"pnpm@' package.json 2>/dev/null; then
  manager="pnpm"
elif grep -qE '"packageManager"[[:space:]]*:[[:space:]]*"yarn@' package.json 2>/dev/null; then
  manager="yarn"
fi

# O cache do setup-node so funciona quando existe um lockfile correspondente.
cache=""
case "$manager" in
  npm) [ -f "package-lock.json" ] && cache="npm" ;;
  pnpm) cache="pnpm" ;;
  yarn) cache="yarn" ;;
esac

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'manager=%s\n' "$manager" >> "$GITHUB_OUTPUT"
  printf 'cache=%s\n' "$cache" >> "$GITHUB_OUTPUT"
else
  printf 'manager=%s\ncache=%s\n' "$manager" "$cache"
fi

printf 'Gerenciador de pacotes: %s (cache: %s)\n' "$manager" "${cache:-desativado}"
