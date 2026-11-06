# explicai-mcp

Servidor MCP para o agente de IA montar e exportar manuais do [Explicaí](https://github.com/gabriel-codesampaio/explicai-studio): ele cria o manual, as páginas, importa e marca imagens e exporta em HTML, Markdown ou PDF. O Studio abre o resultado como qualquer outro manual.

**In English:** an MCP server (stdio) that lets an AI agent create Explicaí manuals: pages, images with numbered markers and clickable areas, and export to HTML, Markdown or PDF. It never approves, publishes or deletes anything. Quick start: `npx explicai-mcp <workspace>`. Levels `--level read|draft|update` and `--manual <slug>` reduce what the agent can touch, but they are not a security boundary (see "Limite" below).

Status: pausado em 0.x. Funciona, mas a prioridade agora é o Studio; a API pode mudar entre versões 0.x.

**Status:** paused at 0.x. It works, but the focus is the Studio now; the API may change between 0.x releases.

## Instalação

Requer Node 22.12 ou mais novo.

```bash
npx explicai-mcp <workspace> [--level read|draft|update] [--manual <slug>]... [--allow-dir <pasta>]...
```

`<workspace>` é a pasta que guarda os manuais (uma subpasta por manual). No `.mcp.json` do projeto:

```json
{
  "mcpServers": {
    "explicai": { "command": "npx", "args": ["explicai-mcp", "./manuais"] }
  }
}
```

Um servidor por projeto: o workspace vem da linha de comando e nunca de argumento de tool.

## Níveis de autonomia

| `--level` | O agente pode |
|---|---|
| `read` | Listar manuais, ler a árvore e as páginas. |
| `draft` (padrão) | Também criar manual novo, adicionar páginas, importar e marcar imagens, exportar, e editar páginas que ainda estão em `rascunho`. |
| `update` | Também editar páginas que já passaram de `rascunho` (`revisao`, `aprovado`, `publicado`). |

A tool fora do nível não é registrada, então o modelo nem a vê. Em nenhum nível o agente apaga página, aprova ou publica: tudo que ele grava nasce `rascunho`, e `update_page` só aceita `rascunho` ou `revisao`. Isso é da pessoa, no Studio.

`--manual <slug>` (repetível) limita o servidor a esses manuais. Os outros não aparecem e a escrita neles é recusada. Com ele, `create_manual` não é registrada.

## Tools

| Tool | Nível | O que faz |
|---|---|---|
| `list_manuals`, `get_manual`, `read_page` | read | Leitura. `read_page` devolve o `rev` da página; com `section` devolve só aquela seção. |
| `check_manual` | read | Só lê. Aponta passo sem "Resultado:", página com passos e sem print, link morto, imagem que falta ou sem marcação, hotspot para página apagada e "A confirmar". |
| `create_manual`, `add_page` | draft | Cria manual (recusa slug repetido) e uma página. |
| `add_pages` | draft | Grava a árvore inteira de uma vez (`title`, `body`, `children`), com as mesmas checagens e o aviso de segredo de `add_page`. |
| `update_page` | draft | Edita com o `rev` lido; `section` + `body` troca só uma seção, pelo título. `rev` antigo não grava; ao mudar o corpo, guarda a versão "Antes do agente". |
| `add_image` | draft | Importa PNG, JPG, GIF ou WebP de até 10 MB, de uma pasta permitida ou em base64. Sem SVG. Devolve a linha Markdown para colar no passo. |
| `annotate_image` | draft | Marcadores numerados, destaques, setas e áreas clicáveis, em coordenadas de 0 a 1 ou em pixels. |
| `redact_image` | draft | Troca uma imagem por uma cópia que o agente já tarjou (PNG, JPG ou WebP). O original some e as marcações seguem valendo. |
| `export_manual` | draft | HTML, Markdown ou PDF (PDF precisa de Chrome ou Edge). `audience` exporta só o que um perfil vê. |

Também há os resources `explicai://format`, `explicai://writing-guide` e `explicai://templates/{tipo}` (`modulo`, `onboarding`, `administracao`: o molde de cada nível da árvore), e os prompts `build_manual_autonomous` e `build_manual_guided` (o guiado manda parar e esperar a aprovação da pessoa antes de gravar), mais:

- `review_manual`: só lê e lista achados por página, sem corrigir.
- `capture_walkthrough` (draft): percorre a tarefa no navegador do agente, um print por passo, posição real por `getBoundingClientRect`, marcações em pixels, tarja em dado sensível; não apaga nem envia dados sem perguntar.
- `update_manual` (só `--level update`): acha as páginas afetadas por uma mudança, mostra antes e depois e grava só com aprovação.
- `import_manual` (draft): lê Markdown, HTML, PDF de texto (melhor esforço) ou um manual do Explicaí, pelas ferramentas de arquivo do cliente, e grava num manual **novo**, sempre como rascunho. Entrega um relatório fixo: o que veio por página, o que se perdeu (imagem, marcação queimada, print sem fonte, link quebrado), instrução achada na origem e o resultado do `check_manual`.

Todos tratam texto do repositório, da web e do próprio manual como dado, não como ordem. O essencial dos resources vai embutido nos prompts, porque muitos clientes não mostram resources.

Público: `add_page`, `add_pages` e `update_page` aceitam `audience` (lista de perfis; sem ela, a página é de todos e as filhas herdam). `export_manual` com `audience` gera o manual de um perfil, sem texto, imagem nem sumário das outras páginas. **Isso não é controle de acesso:** os arquivos do manual guardam tudo, então entregue só o export. `update_page` que muda o público de página aprovada a devolve para `revisao`.

`add_image` lê arquivos só do workspace, da pasta onde o servidor abriu e das pastas de `--allow-dir`. Links simbólicos que saem delas são recusados, e as mensagens de erro não mostram caminho absoluto. `add_page` e `update_page` avisam, sem bloquear, quando o corpo parece conter chave ou token.

Atenção: `--allow-dir` e a pasta onde o servidor abre entram na lista de leitura de `add_image`. Se você abrir o servidor na sua home, o agente pode importar qualquer imagem de toda a home. Abra numa pasta de projeto ou use `--allow-dir` com pastas específicas.

## Importar

`import_manual` traz um manual que já existe (Markdown, HTML, PDF de texto, ou a pasta de um manual de uma versão antiga do Explicaí) para um manual novo. Ele não tem tool própria: o agente lê a origem com as ferramentas de arquivo do cliente e grava com as tools de sempre (`create_manual`, `add_pages`, `add_image`), então vale o nível `draft`. A origem nunca é alterada nem apagada, o texto dela é tratado como dado e o teto é de 30 MB por arquivo e 100 páginas por chamada. PDF é melhor esforço. Word, Confluence e GitBook: exporte para HTML ou Markdown antes.

Limite: o MCP não controla o que o cliente lê. Um agente com ferramenta de leitura própria abre qualquer arquivo que o sistema deixar; `--allow-dir` só limita o `add_image`. Abra o cliente numa pasta de projeto.

## Compatibilidade com o explicai

O MCP usa o pacote `explicai` (o core com `explicai/core`) e aceita as versões `>=1.0.0 <2.0.0`. Ao iniciar, ele confere a versão instalada; fora da faixa, não sobe e diz o que fazer:

- `explicai` antigo demais: `npm install explicai@latest`.
- `explicai` mais novo do que o MCP conhece: `npm install explicai-mcp@latest`.

O MCP segue na 0.x, com versão própria; só o Studio (`explicai`) vai à 1.0. A mesma faixa está em `peerDependencies`.

## Limite

`--level` e `--manual` evitam engano, não são barreira de segurança. Um agente que tem Read, Write e Bash próprios lê e grava qualquer arquivo do disco sem passar por este servidor. Isolamento de verdade vem das permissões do próprio cliente.

## Desenvolvimento

```bash
npm install
npm run check   # biome, tsc e vitest
```

Para contribuir, veja o [guia](https://github.com/gabriel-codesampaio/explicai-studio/blob/main/CONTRIBUTING.md) e o [código de conduta](https://github.com/gabriel-codesampaio/explicai-studio/blob/main/CODE_OF_CONDUCT.md). Falha de segurança: gabriel@codesampa.io.

Licença MIT.
