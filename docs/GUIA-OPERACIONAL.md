# Joinvix Deploy Web — guia operacional

Painel web local para publicar projetos (Lovable, Vite, React Router, Next export, Astro…) em hospedagem FTP, usando GitHub Actions. A interface React roda no navegador e as operações privilegiadas ficam na API Node, sem expor o `.env` ou o token do GitHub ao cliente.

## Fluxo de publicação

1. Selecione o repositório da organização.
2. Preencha domínio, servidor FTP, login e senha.
3. **Salvar configuração** grava os secrets e os dois workflows no repositório.
4. **Publicar agora** dispara o deploy e o painel acompanha a execução em tempo real.

Os dados não sensíveis (domínio, servidor, login, pasta remota, protocolo) ficam salvos por repositório no navegador, então republicar um site já configurado exige apenas a senha e um clique. A senha FTP nunca é persistida.

Marque **Simular envio (dry-run)** para validar todo o processo — build, detecção da pasta e conexão FTP — sem gravar nada no servidor de hospedagem.

### Workflows desatualizados

Os templates carregam um marcador `# joinvix-deploy-template: <versão>`. Ao selecionar um repositório, o painel compara esse marcador com a versão que ele gera e avisa quando o repositório ainda roda um workflow antigo — situação em que a detecção da pasta de build e o `FTP_SERVER` ainda não existem. Basta clicar em **Salvar configuração** para atualizar.

Quem mexer nos templates deve incrementar `WORKFLOW_TEMPLATE_VERSION` em [`server/services/workflow-render.ts`](../server/services/workflow-render.ts); há teste garantindo que os dois arquivos carreguem o marcador.

## Detecção do build

Este é o ponto que costumava quebrar a publicação: o mesmo gerador ora produz um SPA estático em `dist/`, ora um build híbrido com `dist/client` + `dist/server`. Enviar `dist/` inteiro nesse segundo caso publica o bundle de servidor e deixa o site sem `index.html` na raiz.

O workflow agora resolve a pasta correta antes de enviar. A ordem de busca é:

| Layout | Pasta publicada |
| --- | --- |
| Vite SSR, React Router framework mode | `dist/client` |
| Nuxt, Angular, builds com pasta pública separada | `dist/public`, `dist/spa`, `dist/static`, `dist/browser` |
| Vite/Astro estático | `dist` |
| Remix, React Router v7 | `build/client` |
| Create React App | `build` |
| Next.js `output: export` | `out` |
| Nuxt 3 | `.output/public` |
| SvelteKit adapter-static | `.svelte-kit/output/client` |

O critério é a presença de `index.html` — ou de `_shell.html`, que é como o TanStack Start em modo SPA nomeia o shell; nesse caso o passo gera o `index.html` a partir dele. Se nada for encontrado, o job falha listando o conteúdo real das pastas de build, em vez de enviar arquivos errados. Quando existe um bundle de servidor, ele é ignorado e o job registra um aviso: o envio por FTP é estático e o site roda como SPA.

O passo também gera, dentro da pasta publicada:

- `404.html`, cópia do `index.html`, para hospedagens sem `mod_rewrite`;
- `.htaccess` com fallback de rotas, compressão e cache de assets.

### Projetos TanStack Start (Lovable recente)

Os projetos gerados pelo Lovable hoje usam TanStack Start e, por padrão, compilam com Nitro para Cloudflare Workers: o build produz `.output/server` e **nenhum HTML estático**, porque a página é montada a cada requisição. Não há o que enviar por FTP, e o workflow falha com essa explicação em vez de publicar algo quebrado.

Para publicar um desses projetos em hospedagem estática, converta-o para SPA no próprio repositório, em `vite.config.ts`:

```ts
export default defineConfig({
  // Build estático: sem runtime de servidor, saída só em ./dist
  nitro: false,
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true },
  },
  vite: {
    build: { outDir: "dist" },
  },
});
```

Só isso. O passo de detecção cuida do resto — achata `dist/client`, descarta o bundle de servidor, converte `_shell.html` em `index.html` e cria o fallback de rotas. Não é preciso adicionar nenhum script de pós-build ao projeto.

A alternativa, se o site precisar mesmo de renderização no servidor, é hospedá-lo onde um runtime Node ou Workers possa rodar, em vez de FTP.

### Variáveis de repositório (opcionais)

Configure em *Settings → Secrets and variables → Actions → Variables*:

| Variável | Efeito |
| --- | --- |
| `PUBLISH_DIR` | Força a pasta publicada, ignorando a detecção automática. |
| `SPA_FALLBACK` | `false` desativa a criação de `404.html` e `.htaccess`. |

## Secrets criados no repositório

O painel grava e mantém sincronizados:

| Secret | Origem | Obrigatório |
| --- | --- | --- |
| `DEPLOY_DOMAIN` | campo Domínio | sim |
| `FTP_SERVER` | campo Servidor FTP | sim |
| `FTP_LOGIN` | campo Login FTP | sim |
| `FTP_PASSWORD` | campo Senha FTP | sim |
| `FTP_SERVER_DIR` | opções avançadas | não (padrão `domains/<domínio>/public_html`) |
| `FTP_PROTOCOL` | opções avançadas | não (padrão: detecção automática) |
| `FTP_PORT` | opções avançadas | não (padrão `21`) |
| `BUILD_ENV_FILE` | opções avançadas | não |

Os secrets opcionais deixados em branco são **removidos** do repositório, para que configuração antiga não continue valendo.

`BUILD_ENV_FILE` recebe linhas `CHAVE=valor` e vira um `.env.production.local` durante o build — útil para projetos Lovable que dependem de `VITE_SUPABASE_URL` e afins. O arquivo é apagado do runner logo após o build.

### Protocolo de transferência

Com o protocolo em **Automático**, o workflow testa FTPS explícito (AUTH TLS) antes do envio e só cai para FTP simples se o servidor recusar — nesse caso registra um aviso na execução. Para fixar o comportamento, escolha `FTPS explícito`, `FTPS implícito` ou `FTP simples` nas opções avançadas.

## Política de rede

O painel foi projetado para funcionar exclusivamente na máquina local e na rede privada:

- aceita loopback, IPv4 privado (`10/8`, `172.16/12`, `192.168/16`) e IPv6 local;
- rejeita conexões originadas de IPs públicos;
- rejeita hosts públicos, origens cruzadas e headers de proxy;
- não confia em `X-Forwarded-For` ou headers semelhantes;
- bloqueia progressivamente tentativas repetidas de autenticação e limita as operações que alteram repositórios;
- serve somente os arquivos compilados em `dist/`; o `.env` nunca faz parte da raiz pública;
- o Vite aplica a mesma política durante o desenvolvimento.

O acesso ao GitHub permanece como conexão **de saída**, pois é necessário para listar repositórios, criar secrets e gerenciar workflows. A restrição local se refere às conexões de entrada no painel.

Não publique a porta no roteador e não coloque o serviço atrás de proxy reverso público. Como camada adicional, mantenha a porta liberada somente no perfil **Rede privada** do Firewall do Windows.

## Requisitos

- Node.js 22 ou superior;
- token fine-grained do GitHub com acesso aos repositórios da organização.

### Permissões do token

No GitHub, em *Settings → Developer settings → Personal access tokens → Fine-grained tokens*, com acesso aos repositórios da organização:

| Permissão | Nível | Para quê |
| --- | --- | --- |
| Metadata | Leitura | listar repositórios |
| Contents | Leitura e escrita | gravar e remover os workflows |
| Workflows | Leitura e escrita | obrigatória para escrever em `.github/workflows/` |
| Secrets | Leitura e escrita | `FTP_*`, `DEPLOY_DOMAIN`, `BUILD_ENV_FILE` |
| Actions | Leitura e escrita | botão *Publicar agora* e histórico de execuções |

## Instalação

Cada pessoa roda o painel na própria máquina. Nada precisa ser hospedado.

```bash
npm ci
npm run setup
npm run build
npm start
```

Depois abra <http://localhost:4173> **na mesma máquina** e preencha o token do GitHub e a organização na tela de configuração. Não é preciso editar arquivos à mão.

O token é enviado uma única vez ao servidor local, gravado no `.env` daquele computador e nunca devolvido ao navegador — a tela mostra apenas uma dica do tipo `github_pat_…a1b2` para você reconhecer qual token está ativo. O botão **Testar acesso** valida o token contra o GitHub e informa a data de expiração antes do primeiro deploy.

A tela de configuração só responde a requisições vindas da própria máquina (loopback), mesmo quando o painel está aberto à rede: quem configura o painel é quem está sentado nele. Token, organização e servidor FTP padrão valem imediatamente; alterar `SERVER_HOST` ou `PORT` exige editar o `.env` e reiniciar.

## Acesso pela rede local

Por padrão o painel escuta apenas em `127.0.0.1`, então nada trafega pela rede e não há o que interceptar. Só mude isso se outras máquinas precisarem acessar o mesmo painel:

```env
SERVER_HOST=0.0.0.0
PANEL_ACCESS_TOKEN=uma_chave_longa_e_aleatoria
```

Nesse caso a chave de acesso passa a ser obrigatória na prática — o servidor avisa no arranque se ela estiver faltando. Lembre que o tráfego continua em HTTP: use isso apenas em rede confiável, sem expor a porta no roteador.

## Desenvolvimento

```bash
npm install
npm run dev
```

O Vite serve a interface e a API no mesmo endereço, com a mesma política de rede da produção. Use `http://localhost:5173`.

## Reinstalação e atualização

```bash
git pull
npm ci
npm run build
npm start
```

O `.env` não é tocado por atualizações.

O servidor usa a porta `4173` por padrão e mostra os endereços LAN ao iniciar. Ele encerra de forma limpa em `SIGINT`/`SIGTERM` e avisa quando a porta já está ocupada.

## Manutenção e validação

```bash
npm run clean
npm run check
npm audit
```

- `setup`: cria o `.env` a partir do modelo e mostra o que falta configurar;
- `clean`: remove builds e resíduos antigos do Electron;
- `check`: executa lint, testes, TypeScript e builds;
- `audit`: verifica vulnerabilidades das dependências.

Os testes cobrem a política de rede, o bloqueio progressivo de autenticação, a leitura do `.env`, a geração dos workflows (inclusive validação do YAML resultante) e a detecção da pasta de build em cada layout suportado.

O diagnóstico completo, os riscos conhecidos e o checklist de entrada em produção estão em [`PRONTIDAO-PRODUCAO.md`](PRONTIDAO-PRODUCAO.md).

## Estrutura

```text
public/                 arquivos públicos mínimos
scripts/                manutenção do projeto
server/
  api/                  rotas HTTP
  config/               leitura e escrita segura do .env
  security/             política de acesso LAN e bloqueio de força bruta
  services/             integração GitHub, criptografia e geração de workflows
src/
  components/ui/        componentes reutilizáveis
  features/deploy/      fluxo e interface do painel
  lib/                  cliente HTTP
  shared/               contratos compartilhados
workflows/
  *.yml                 templates publicados nos repositórios
  scripts/              passos em Bash embutidos nos templates (testados)
```

Os passos de shell dos workflows ficam em `workflows/scripts/*.sh` e são embutidos nos templates YAML no momento da publicação. Isso permite testá-los de verdade, com projetos de exemplo, em vez de confiar em texto solto dentro do YAML.

## Segurança dos dados

- `.env`, builds, logs e dependências são ignorados pelo Git;
- `GITHUB_TOKEN` e `PANEL_ACCESS_TOKEN` existem somente no servidor; a interface recebe no máximo uma dica mascarada do token;
- a tela de configuração só aceita requisições de loopback e grava o `.env` com permissão restrita;
- a senha FTP não é persistida no navegador;
- a API limita operações à organização configurada;
- branches, nomes de repositório, domínios, hosts, portas e caminhos de workflow são validados;
- as mensagens de erro do GitHub são resumidas antes de chegarem ao cliente;
- o servidor aplica CSP, bloqueio de iframe, `nosniff`, política de referrer e política de permissões.
