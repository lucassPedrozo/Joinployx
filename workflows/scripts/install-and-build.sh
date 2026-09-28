# Instala dependencias e executa o build, tolerando lockfiles dessincronizados
# (situacao comum em projetos exportados do Lovable).
set -euo pipefail

manager="${PACKAGE_MANAGER:-npm}"

if [ ! -f "package.json" ]; then
  printf '::error::package.json nao encontrado na raiz do repositorio.\n'
  exit 1
fi

# Variaveis de build opcionais (ex.: VITE_SUPABASE_URL) vindas de um secret.
if [ -n "${BUILD_ENV_FILE:-}" ]; then
  printf '%s\n' "$BUILD_ENV_FILE" > .env.production.local
  printf 'Arquivo .env.production.local criado a partir do secret BUILD_ENV_FILE.\n'
fi

printf '::group::Instalando dependencias (%s)\n' "$manager"
case "$manager" in
  bun)
    bun install --frozen-lockfile || bun install
    ;;
  pnpm)
    pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
    ;;
  yarn)
    yarn install --immutable || yarn install
    ;;
  *)
    if [ -f "package-lock.json" ]; then
      npm ci --include=dev --legacy-peer-deps \
        || npm install --include=dev --legacy-peer-deps --no-audit --no-fund
    else
      npm install --include=dev --legacy-peer-deps --no-audit --no-fund
    fi
    ;;
esac
printf '::endgroup::\n'

build_script="$(node -p "const s=(require('./package.json').scripts)||{};['build','build:prod','build:production','build:client'].find(n=>s[n])||''" 2>/dev/null || printf '')"

if [ -z "$build_script" ]; then
  printf '::error::Nenhum script de build encontrado em package.json (build, build:prod, build:production).\n'
  exit 1
fi

printf '::group::Executando build (%s run %s)\n' "$manager" "$build_script"
case "$manager" in
  bun) bun run "$build_script" ;;
  pnpm) pnpm run "$build_script" ;;
  yarn) yarn run "$build_script" ;;
  *) npm run "$build_script" ;;
esac
printf '::endgroup::\n'

# Nunca deixar credenciais de build no runner apos o uso.
rm -f .env.production.local
