# Estado atual — atualize ao fim de cada sessão

**Última atualização:** 2026-10-09 (sessão 1: inspeção, diagnóstico e plano)

## Onde estamos
Fase 1 (inspeção) e fase 2 (diagnóstico) concluídas. Arquitetura e plano propostos em `docs/03-plano-mvp.md`. **Nenhum código escrito ainda.**

## Concluído
- Inspeção do repositório: estava vazio (só o README).
- Inspeção de `terrafabricio/sophia`: é outro produto e não será reaproveitado (D-001).
- Decisões com o usuário: macOS desktop, 16 GB, IA 100% local, Tauri + TypeScript, v0.1 cobrindo as 4 dores. Ver `docs/01-decisoes.md`.
- Investigação do Laya (confirmado: app desktop, fora do MVP) e do EmbeddingGemma 2 (só fontes secundárias). Ver `docs/02-investigacao-ia.md`.

## Pendente
- Salvar a especificação original do usuário em `docs/00-especificacao.md`.
- Etapa 0: fundação do monorepo.
- Confirmar o EmbeddingGemma 2 no model card oficial.

## Problemas conhecidos
- Nenhum (não há código).

## Testes executados
- Nenhum (não há código).

## Próximo passo recomendado
Etapa 0 + etapa 1: monorepo TypeScript com Vitest e CI, depois schema SQLite e domínio (Inbox, Tarefa, Projeto, Lembrete, Histórico) com testes de persistência e idempotência.
