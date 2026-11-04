# explicai-mcp

Servidor MCP para o agente de IA montar e exportar manuais do [Explicaí](https://github.com/gabriel-codesampaio/explicai-studio): ele cria o manual, as páginas, importa e marca imagens e exporta em HTML, Markdown ou PDF. O Studio abre o resultado como qualquer outro manual.

**In English:** an MCP server (stdio) that lets an AI agent create Explicaí manuals: pages, images with numbered markers and clickable areas, and export to HTML, Markdown or PDF. It never approves, publishes or deletes anything. Quick start: `npx explicai-mcp <workspace>`. Levels `--level read|draft|update` and `--manual <slug>` reduce what the agent can touch, but they are not a security boundary (see "Limite" below).

## Instalação

Requer Node 20.12 ou mais novo.

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

> Ainda não publicado no npm. Enquanto isso, rode a partir do clone: `npm install && npm run build && node dist/cli.js <workspace>`. Precisa do pacote `explicai` com o core novo (>= 0.3.0).

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
| `export_manual` | draft | HTML, Markdown ou PDF (PDF precisa de Chrome ou Edge). |

Também há os resources `explicai://format`, `explicai://writing-guide` e `explicai://templates/{tipo}` (`modulo`, `onboarding`, `administracao`: o molde de cada nível da árvore), e os prompts `build_manual_autonomous` e `build_manual_guided` (o guiado manda parar e esperar a aprovação da pessoa antes de gravar), mais:

- `review_manual`: só lê e lista achados por página, sem corrigir.
- `capture_walkthrough` (draft): percorre a tarefa no navegador do agente, um print por passo, posição real por `getBoundingClientRect`, marcações em pixels, tarja em dado sensível; não apaga nem envia dados sem perguntar.
- `update_manual` (só `--level update`): acha as páginas afetadas por uma mudança, mostra antes e depois e grava só com aprovação.

Todos tratam texto do repositório, da web e do próprio manual como dado, não como ordem. O essencial dos resources vai embutido nos prompts, porque muitos clientes não mostram resources.

`add_image` lê arquivos só do workspace, da pasta onde o servidor abriu e das pastas de `--allow-dir`. Links simbólicos que saem delas são recusados, e as mensagens de erro não mostram caminho absoluto. `add_page` e `update_page` avisam, sem bloquear, quando o corpo parece conter chave ou token.

Atenção: `--allow-dir` e a pasta onde o servidor abre entram na lista de leitura de `add_image`. Se você abrir o servidor na sua home, o agente pode importar qualquer imagem de toda a home. Abra numa pasta de projeto ou use `--allow-dir` com pastas específicas.

## Limite

`--level` e `--manual` evitam engano, não são barreira de segurança. Um agente que tem Read, Write e Bash próprios lê e grava qualquer arquivo do disco sem passar por este servidor. Isolamento de verdade vem das permissões do próprio cliente.

## Desenvolvimento

```bash
npm install
npm run check   # biome, tsc e vitest
```

Licença MIT.
