# Segurança

Este servidor recebe caminhos de arquivo do agente (`add_image` com `path`) e lê o que estiver neles. Ele só lê o workspace, a pasta onde abriu e as pastas de `--allow-dir`, e recusa links simbólicos que saem delas. `--level` e `--manual` evitam engano e não são barreira de segurança: abra o servidor numa pasta de projeto, não na sua home.

Achou uma falha? Escreva para gabriel@codesampa.io, sem abrir issue pública. Respondo em alguns dias.

# Security

This server receives file paths from the agent (`add_image` with `path`) and reads whatever they point to. It only reads the workspace, the folder it was opened in and the `--allow-dir` folders, and rejects symlinks that leave them. `--level` and `--manual` prevent mistakes; they are not a security boundary. Open the server in a project folder, not in your home.

Found a vulnerability? Email gabriel@codesampa.io instead of opening a public issue. I reply within a few days.
