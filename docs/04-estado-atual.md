# Estado atual — atualize ao fim de cada sessão

**Última atualização:** 2026-10-20 (sessão 2: etapas 0 e 1)

## Onde estamos
Etapas 0 (fundação) e 1 (banco e domínio) concluídas. O núcleo `packages/core` grava e recupera de verdade, com testes. **Ainda não há interface nem app desktop**: nada disso é usável por você hoje sem código.

## Concluído nesta sessão
**Fundação (etapa 0)**
- Monorepo npm workspaces; TypeScript 6 strict; Vitest 5; ESLint 10; Zod 4.
- CI no GitHub Actions: `npm run check` (lint + tipos + testes) a cada push.

**Banco e domínio (etapa 1)**
- Schema SQLite versionado: migração 001, idempotente, que recusa banco de versão mais nova.
- 8 categorias iniciais da especificação.
- Módulos:

| Módulo | Operações |
|---|---|
| Inbox | capturar só com texto; sugerir/corrigir classificação; converter em tarefa, projeto ou nota (atômico); arquivar; excluir |
| Tarefas | criar, listar, atualizar, concluir, excluir; histórico de alterações; proteção contra duplicata |
| Projetos | criar (estado padrão `idea`), atualizar, listar por estado, excluir; `lastActivityAt` atualizado por tarefas, notas e decisões |
| Decisões | registrar com contexto e justificativa; `proposedBy`; revisar (substituir) |
| Notas | criar, corrigir, marcar como desatualizada, excluir |
| Lembretes | criar (UTC + fuso IANA), reagendar, cancelar; **sem disparo ainda** |
| Exportação | todos os dados em JSON |

- Decisões técnicas D-009 a D-013 em `docs/01-decisoes.md`.

## Testes executados
`npm run check` em 2026-10-20: lint ok, tipos ok, **52 testes passando (7 arquivos)**.

Cenários da especificação (seção 20) cobertos:

| Cenário | Situação |
|---|---|
| 1. Criar tarefa e recuperar | ✅ |
| 2. Mesma solicitação duas vezes | ✅ chave de idempotência + título duplicado |
| 5. Corrigir memória | ✅ (notas: correção e "desatualizada") |
| 6. Excluir informação | ✅ registro, lembretes e conteúdo do histórico (índices de busca ainda não existem) |
| 7. Decisão anterior | ✅ |
| 10. Falha parcial | ✅ rollback real; verificado também quebrando a transação de propósito (o teste reprova) |
| 12. Reiniciar aplicação | ✅ banco em arquivo fechado e reaberto |

Ainda não testados: 3 (lembrete com app fechado: etapas 4 e 5), 4 e 15 (IA ou integração indisponível: etapa 7), 8 (busca semântica: etapa 8), 9 (prazo ambíguo: etapa 2), 11, 13 e 14 (resumo, sobrecarga e retomada: etapa 3).

## Problemas conhecidos
- `node:sqlite` emite `ExperimentalWarning` no Node 22. Ele só é usado nos testes; o app usará o SQLite do Tauri.
- O adaptador de banco do app ainda não existe. Ver risco R-08 em `docs/03-plano-mvp.md`.
- `docs/00-especificacao.md` ainda não foi salvo (falta o texto original).

## Próximo passo recomendado
**Etapa 2: interpretador determinístico de datas em pt-BR** ("amanhã", "sexta 14h", "dia 25"), integrado à conversão da Inbox, com pedido de esclarecimento quando a data for ambígua (cenário 9).

Em paralelo, se você estiver no Mac, vale o **spike R-02**: um app Tauri mínimo na barra de menus que dispara uma notificação depois de 2 minutos com a janela fechada. É o maior risco técnico do projeto.
