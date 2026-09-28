# Descobre qual pasta contem o site estatico pronto para publicacao.
# Lovable (e outros geradores) alternam entre "dist/" plano e "dist/client" +
# "dist/server". Este passo normaliza os dois casos em um unico caminho.
set -euo pipefail

publish_dir_override="${PUBLISH_DIR:-}"
spa_fallback="${SPA_FALLBACK:-true}"
selected=""
server_bundle=""

emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  else
    printf 'output: %s\n' "$1"
  fi
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

fail() {
  printf '::error::%s\n' "$1"
  exit 1
}

# O TanStack Start em modo SPA emite o shell como _shell.html; o restante do
# ecossistema usa index.html.
is_static_root() {
  [ -f "$1/index.html" ] || [ -f "$1/_shell.html" ]
}

# 1) Override explicito via variavel de repositorio.
if [ -n "$publish_dir_override" ]; then
  publish_dir_override="${publish_dir_override#./}"
  publish_dir_override="${publish_dir_override%/}"
  case "$publish_dir_override" in
    /*|*..*) fail "PUBLISH_DIR deve ser um caminho relativo dentro do repositorio." ;;
  esac
  if ! is_static_root "$publish_dir_override"; then
    fail "PUBLISH_DIR=$publish_dir_override nao contem index.html nem _shell.html."
  fi
  selected="$publish_dir_override"
  printf 'Pasta de publicacao definida manualmente: %s\n' "$selected"
fi

# 2) Layouts conhecidos, do mais especifico para o mais generico.
if [ -z "$selected" ]; then
  for candidate in \
    "dist/client" \
    "dist/public" \
    "dist/spa" \
    "dist/static" \
    "dist/browser" \
    "dist" \
    "build/client" \
    "build" \
    "out" \
    ".output/public" \
    ".svelte-kit/output/client"
  do
    if is_static_root "$candidate"; then
      selected="$candidate"
      break
    fi
  done
fi

# 3) Ultima tentativa: procurar qualquer index.html raso fora de node_modules.
if [ -z "$selected" ]; then
  fallback="$(find . -maxdepth 4 \( -name index.html -o -name _shell.html \) -not -path './node_modules/*' -not -path './.git/*' -not -path './src/*' -not -path './public/*' -not -path './.github/*' -printf '%d %h\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2- || true)"
  if [ -n "$fallback" ]; then
    selected="${fallback#./}"
    printf '::warning::Layout de build nao reconhecido. Usando %s por deteccao automatica.\n' "$selected"
  fi
fi

# Detecta bundle de servidor (SSR). O deploy por FTP e estatico, entao o
# bundle nao e enviado; quando existe HTML estatico o site roda como SPA.
for candidate in "dist/server" "build/server" ".output/server" "dist/ssr" ".svelte-kit/output/server"; do
  if [ -d "$candidate" ]; then
    server_bundle="$candidate"
    break
  fi
done

if [ -z "$selected" ]; then
  printf '::error::Nenhuma pasta de build com index.html foi encontrada.\n'
  printf 'Conteudo da raiz do projeto:\n'
  ls -A1 . | sed 's/^/  /' | head -40
  # Dois niveis: com um so, um .output/public vazio de HTML passa despercebido.
  for dir in dist build out .output .svelte-kit/output; do
    if [ -d "$dir" ]; then
      printf 'Conteudo de %s:\n' "$dir"
      find "$dir" -mindepth 1 -maxdepth 2 2>/dev/null | sed 's/^/  /' | head -30
    fi
  done

  if [ -n "$server_bundle" ]; then
    printf '::error::Este projeto e renderizado no servidor: o build gerou %s e nenhum HTML estatico.\n' "$server_bundle"
    printf 'Frameworks como TanStack Start, Nuxt, Remix e Next em modo SSR montam o HTML a cada\n'
    printf 'requisicao, entao nao ha o que enviar para uma hospedagem FTP estatica.\n'
    printf 'Saidas possiveis:\n'
    printf '  - habilitar prerender ou modo SPA no projeto, para o build emitir index.html;\n'
    printf '  - hospedar este site onde um servidor Node possa rodar, em vez de FTP.\n'
    fail "Publicacao por FTP nao se aplica a este projeto."
  fi

  fail "Ajuste o script de build ou defina a variavel de repositorio PUBLISH_DIR."
fi

if [ -n "$server_bundle" ]; then
  printf '::notice::Build hibrido detectado (%s). Apenas os arquivos estaticos de %s serao publicados.\n' "$server_bundle" "$selected"
fi

# Modo SPA do TanStack Start: o shell vira o index.html do site estatico.
if [ ! -f "$selected/index.html" ] && [ -f "$selected/_shell.html" ]; then
  cp "$selected/_shell.html" "$selected/index.html"
  printf 'index.html gerado a partir de _shell.html (modo SPA do TanStack Start).\n'
fi

# Guarda contra publicar o index.html de desenvolvimento por engano.
if grep -qE 'src="/?src/(main|entry|index)\.[jt]sx?"' "$selected/index.html" 2>/dev/null; then
  fail "$selected/index.html aponta para o codigo-fonte. O build nao foi gerado corretamente."
fi

if [ -z "$(ls -A "$selected")" ]; then
  fail "A pasta $selected esta vazia."
fi

# Fallback de rotas para SPA em hospedagem Apache/cPanel.
if [ "$spa_fallback" != "false" ]; then
  if [ ! -f "$selected/404.html" ]; then
    cp "$selected/index.html" "$selected/404.html"
    printf 'Criado %s/404.html como fallback de rotas.\n' "$selected"
  fi

  if [ ! -f "$selected/.htaccess" ]; then
    cat > "$selected/.htaccess" <<'HTACCESS'
# Gerado automaticamente pelo painel de deploy.
# Defina a variavel de repositorio SPA_FALLBACK=false para desativar.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule . /index.html [L]
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml
  AddOutputFilterByType DEFLATE application/javascript application/json
  AddOutputFilterByType DEFLATE image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  <FilesMatch "\.(js|css|woff2?|png|jpe?g|gif|svg|webp|avif|ico)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\.(html|json)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>

ErrorDocument 404 /index.html
HTACCESS
    printf 'Criado %s/.htaccess com fallback de rotas e cache.\n' "$selected"
  fi
fi

file_count="$(find "$selected" -type f | wc -l | tr -d ' ')"
total_size="$(du -sh "$selected" 2>/dev/null | cut -f1 || echo '?')"

emit "dist-dir=$selected"
emit "file-count=$file_count"
emit "server-bundle=$server_bundle"

printf 'Pasta de publicacao: %s\n' "$selected"
printf 'Arquivos: %s | Tamanho: %s\n' "$file_count" "$total_size"
find "$selected" -maxdepth 2 -type f | head -30

summary "### Build"
summary ""
summary "| Item | Valor |"
summary "| --- | --- |"
summary "| Pasta publicada | \`$selected\` |"
summary "| Arquivos | $file_count |"
summary "| Tamanho | $total_size |"
summary "| Bundle de servidor | ${server_bundle:-nenhum} |"
