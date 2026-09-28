# Joinvix Deploy

Painel web local para publicar projetos front-end (Lovable, Vite, React Router, Next export, Astro e afins) em hospedagem FTP usando GitHub Actions. A pessoa escolhe um repositorio da organizacao, informa dominio e credenciais FTP, e o painel grava os secrets criptografados, gera os workflows de build e deploy no repositorio e acompanha a execucao em tempo real.

## Visao geral

O projeto e dividido em duas partes: uma interface React que roda no navegador e uma API Node que concentra todas as operacoes privilegiadas. O token do GitHub fica somente no servidor local, dentro do `.env` da maquina, e nunca e devolvido ao navegador. Os secrets de FTP sao criptografados com libsodium (sealed box) antes de serem enviados para a API do GitHub, e os workflows gerados detectam automaticamente a pasta correta de build antes de publicar.

O painel foi desenhado para rodar na propria maquina ou na rede local: por padrao escuta apenas em `127.0.0.1`, rejeita IPs publicos, headers de proxy e origens cruzadas, e aplica bloqueio progressivo contra tentativas repetidas de autenticacao.

## Funcionalidades

- Listagem dos repositorios da organizacao configurada, com paginacao.
- Gravacao dos secrets `DEPLOY_DOMAIN`, `FTP_SERVER`, `FTP_LOGIN`, `FTP_PASSWORD` e opcionais, criptografados com a chave publica do repositorio.
- Geracao e atualizacao dos workflows `Build` e `Deploy via FTP` com marcador de versao do template.
- Disparo do deploy pelo botao `Publicar agora` e modo de simulacao (`dry-run`) sem gravar arquivos no servidor.
- Historico das execucoes do GitHub Actions acompanhado pela interface.
- Deteccao automatica da pasta de build (`dist`, `dist/client`, `build`, `out`, `.output/public` e outros layouts).
- Negociacao de FTPS explicito com fallback sinalizado para FTP simples.
- Tela de configuracao restrita ao loopback para token, organizacao e servidor FTP padrao.
- Politica de rede local, CSP e headers de seguranca no servidor.
- Senha FTP mantida apenas em memoria, nunca persistida no navegador.

## Estrutura do projeto

```text
.
|-- docs/
|   |-- GUIA-OPERACIONAL.md
|   `-- PRONTIDAO-PRODUCAO.md
|-- public/
|   `-- favicon.png
|-- scripts/
|   |-- clean.mjs
|   `-- setup.mjs
|-- server/
|   |-- api/
|   |-- config/
|   |-- security/
|   |-- services/
|   `-- index.ts
|-- src/
|   |-- components/ui/
|   |-- features/deploy/
|   |-- lib/
|   |-- shared/
|   |-- App.tsx
|   `-- main.tsx
|-- workflows/
|   |-- scripts/
|   |-- build.yml
|   `-- deploy-via-ftp.yml
|-- .env.example
|-- index.html
|-- package.json
|-- vite.config.ts
`-- README.md
```

## Como executar

Requisitos: Node.js 22 ou superior e um token fine-grained do GitHub (prefixo `github_pat_`) com acesso aos repositorios da organizacao.

```bash
npm ci
npm run setup
npm run build
npm start
```

Depois abra `http://localhost:4173` na mesma maquina e preencha o token do GitHub e a organizacao na tela de configuracao. O `.env` e criado a partir do `.env.example` e nunca deve ser versionado.

Para desenvolvimento:

```bash
npm install
npm run dev
```

Para validar o projeto:

```bash
npm run check
npm audit
```

Permissoes do token, acesso pela rede local, secrets gerados, deteccao de build e politica de rede estao detalhados em [`docs/GUIA-OPERACIONAL.md`](docs/GUIA-OPERACIONAL.md). O checklist de producao esta em [`docs/PRONTIDAO-PRODUCAO.md`](docs/PRONTIDAO-PRODUCAO.md).

## Stacks

- TypeScript
- React 19
- Vite
- Node.js 22 (`node:http`)
- libsodium
- GitHub REST API
- GitHub Actions
- Bash
- Node test runner
- ESLint

## Hook para portfolio

**Categoria do projeto:** Ferramenta interna / DevOps

**Breve descricao:** Painel web local em React e Node que automatiza a publicacao de sites em hospedagem FTP, gravando secrets criptografados e workflows do GitHub Actions nos repositorios de uma organizacao.

**Contexto:** O projeto foi desenvolvido para eliminar a configuracao manual de deploy de cada site: antes era preciso criar secrets, copiar workflows e descobrir a pasta de build de cada gerador. O painel centraliza esse fluxo com foco em seguranca, mantendo o token do GitHub apenas no servidor local e restringindo o acesso a maquina e a rede privada.

**Resultado:** Uma ferramenta funcional em que a pessoa escolhe o repositorio, informa dominio e credenciais FTP, salva a configuracao e publica o site com um clique, acompanhando o build e o envio pelo proprio painel.

**Destaques:**

- Criptografia dos secrets com libsodium sealed box antes do envio a API do GitHub.
- Token do GitHub isolado no servidor, com apenas uma dica mascarada exibida na interface.
- Politica de rede local com bloqueio de IPs publicos, proxies e origens cruzadas.
- Bloqueio progressivo de autenticacao e rate limiting nas rotas que alteram repositorios.
- Workflows versionados com deteccao automatica da pasta de build para varios frameworks.
- Scripts Bash dos workflows testados com projetos de exemplo reais.
- 52 testes automatizados cobrindo rede, autenticacao, `.env`, workflows e build.

**Stacks:**

- TypeScript
- React
- Vite
- Node.js
- libsodium
- GitHub REST API
- GitHub Actions
- Bash

**Imagens:**

- Ainda nao ha capturas de tela versionadas.
