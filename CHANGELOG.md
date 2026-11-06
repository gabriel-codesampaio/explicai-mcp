# Changelog

Todas as mudanças importantes do explicai-mcp ficam aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

All notable changes to explicai-mcp are listed here, in Portuguese first with a short English summary at the end of each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Adicionado

- Confere a versão do pacote `explicai` ao iniciar (faixa `>=1.0.0 <2.0.0`, igual ao `peerDependencies`). Fora da faixa, o servidor não sobe e a mensagem diz se atualiza o `explicai` ou o `explicai-mcp`.
- `annotate_image` aceita `style` opcional em cada marcador, seta, destaque e área clicável, com enum fechado (cor, tamanho, espessura, preenchimento, borda). `read_page` devolve o `style`; regravar sem `style` não apaga o existente. / `annotate_image` takes an optional closed-enum per-item `style`; `read_page` returns it; rewriting without `style` keeps the existing one.
- `add_pages` avisa segredo no título, tem teto de 100 páginas, 5 níveis e 400 mil caracteres no total (recusa antes de gravar) e, se falhar no meio, lista as páginas já criadas com os ids. / `add_pages` warns about secrets in titles, caps the tree at 100 pages, 5 levels and 400k characters (refused before writing), and lists already-created pages with ids if it fails midway.
- Prompt `import_manual`: importa Markdown, HTML, PDF de texto ou um manual antigo do Explicaí para um manual novo, em rascunho, com relatório fixo. / `import_manual` prompt: imports Markdown, HTML, text PDF or an old Explicaí manual into a new manual, as draft, with a fixed report.

## [0.1.0] - 2026-11-04

Primeira versão publicada. Requer o pacote `explicai` 0.3.0 ou mais novo (o core com `explicai/core`).

### Adicionado

- Servidor MCP por stdio: `npx explicai-mcp <workspace>`, com `--level read|draft|update`, `--manual <slug>` e `--allow-dir <pasta>`. O nível e o recorte por manual reduzem o que o agente alcança, mas não são limite de segurança.
- Tools de leitura: `list_manuals`, `get_manual`, `read_page` (com `rev` e leitura por seção) e `check_manual`.
- Tools de rascunho: `create_manual`, `add_page`, `add_pages`, `update_page` (com `rev` e troca por seção; guarda a versão "Antes do agente"), `add_image`, `annotate_image`, `redact_image` e `export_manual` (HTML, Markdown e PDF, com `audience`).
- Resources `explicai://format`, `explicai://writing-guide` e `explicai://templates/{tipo}`; prompts `build_manual_autonomous`, `build_manual_guided`, `review_manual`, `capture_walkthrough` e `update_manual`.
- O agente nunca apaga página, aprova nem publica: tudo que grava nasce `rascunho`.
- Aviso de segredo ao gravar página, erros com código estável e limite de 10 MB por imagem (PNG, JPG, GIF e WebP; sem SVG).

### English summary

First published release. A stdio MCP server that lets an AI agent build Explicaí manuals: read and check manuals, add pages, import and mark up images, and export to HTML, Markdown or PDF. `--level read|draft|update` and `--manual` narrow what the agent can reach (not a security boundary). The agent never deletes, approves or publishes; everything it writes starts as a draft. Needs `explicai` 0.3.0 or newer.

[Unreleased]: https://github.com/gabriel-codesampaio/explicai-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gabriel-codesampaio/explicai-mcp/releases/tag/v0.1.0
