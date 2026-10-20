# Decisões do projeto — SOPHIA-LOCAL

Registro das decisões tomadas, com motivo e data. Uma decisão só muda com um novo registro aqui.

Legenda: **[confirmada]** decidida pelo usuário · **[técnica]** recomendação de engenharia aceita · **[pendente]** ainda aberta.

---

## D-001 — Produto pessoal, separado da SophIA comercial · [confirmada] · 2026-10-09

A SOPHIA-LOCAL é o sistema operacional **pessoal** do usuário (memória, tarefas, lembretes, projetos, retomada, apoio ao TDAH).

O repositório `terrafabricio/sophia` (Next.js + Supabase + Gemini, voltado a criativos autônomos) é **outro produto** e não é reaproveitado. Começamos do zero.

Consequência: as skills `sophia-master-skill`, `sophia-core-skill` e `sophia-project-structure` descrevem o produto comercial e **não se aplicam** a este repositório. A especificação de referência é `docs/00-especificacao.md` (a ser salva a partir do documento original do usuário).

## D-002 — App desktop para macOS (Apple Silicon) · [confirmada] · 2026-10-09

- Máquina-alvo: Mac Apple Silicon com 16 GB de RAM.
- Formato: app desktop com ícone na barra de menus, notificações nativas e atalho global de captura.
- Celular e sincronização ficam fora do MVP.

## D-003 — IA 100% local, sempre · [confirmada] · 2026-10-09

- Nenhuma conversa, memória ou tarefa sai do Mac.
- Modelos rodam via **Ollama** em `localhost`, um processo local instalado pelo usuário.
- Não haverá provedores de nuvem no MVP. A interface de IA continua abstrata para não fechar portas, mas nenhum adaptador remoto será escrito agora.
- Limite assumido: com 16 GB, o modelo de conversa fica na faixa de ~7–12B parâmetros quantizado. O modelo exato será escolhido **depois de testar no Mac do usuário**.

## D-004 — Stack: Tauri v2 + TypeScript, uma linguagem · [confirmada] · 2026-10-09

- Interface: React + TypeScript dentro do Tauri v2.
- Regras de negócio: **TypeScript puro**, num pacote independente da interface e testável sem o app.
- Banco: **SQLite** local, com migrações versionadas.
- Validação: Zod. Testes: Vitest.
- Rust: só a casca mínima do Tauri (janela, barra de menus, notificações, atalho global). Se o agendador de lembretes precisar rodar fora do webview, esse trecho pequeno pode exigir Rust. Ver risco R-02.

## D-005 — Laya fica fora do MVP · [técnica] · 2026-10-09

O Laya é um app desktop separado, não um modelo de IA. Ver `docs/02-investigacao-ia.md`.

Papel futuro possível: **fonte de entrada opcional**. A SOPHIA leria pela API local do Laya os itens de trabalho que ele já triou (Gmail, Slack, GitHub) e os transformaria em tarefas ou lembretes. Isso entra só depois que o núcleo estiver estável.

## D-006 — EmbeddingGemma 2 para busca semântica, após verificação · [técnica] · 2026-10-09

Candidato para a memória semântica, usando só o encoder de texto. A implementação depende de confirmar no model card oficial: dimensões, prompts de tarefa, licença e disponibilidade no Ollama.

Os vetores guardam o modelo e a versão que os geraram. Trocar de modelo exige reindexar tudo.

## D-007 — Confiabilidade antes da IA · [técnica] · 2026-10-09

A primeira entrega funciona **sem nenhum modelo de IA ligado**. Captura, tarefas, lembretes, painel e retomada são determinísticos.

Depois, a IA entra como camada de interpretação: produz uma intenção estruturada, o software valida e o usuário confirma. Assim o cenário "modelo indisponível" já nasce coberto.

## D-008 — Primeira entrega ataca as 4 dores, em versão fina · [confirmada] · 2026-10-09

O usuário indicou as quatro dores como prioridade:

1. esquecer compromissos;
2. ideias soltas que se perdem;
3. perder o fio dos projetos;
4. não saber por onde começar.

As quatro compartilham a mesma fundação (banco, tarefas, regras). Por isso a v0.1 entrega uma versão **mínima** de cada uma, em vez de aprofundar uma só. Ver `docs/03-plano-mvp.md`.

⚠️ **Risco de escopo:** cada dor pode crescer sem fim. Na v0.1, cada uma tem um critério de aceite fechado e nada além dele.

## D-009 — Escritas só por lote atômico · [técnica] · 2026-10-20

O núcleo nunca abre uma transação e espera entre chamadas. Cada operação monta a lista completa de instruções (registro, histórico, idempotência, atividade do projeto) e envia num único `batch`, que o adaptador executa como tudo ou nada.

Motivo: funciona com qualquer driver, inclusive os que usam pool de conexões, e torna impossível o estado pela metade. Isso está comprovado pelo teste do cenário 10, que reprova quando a transação é removida.

## D-010 — Duas proteções contra duplicata · [técnica] · 2026-10-20

1. **Chave de idempotência** (`idempotencyKey`). A mesma solicitação processada duas vezes (duplo Enter, nova tentativa da IA) devolve o item já criado, marcado com `duplicate: true`.
2. **Título igual a uma tarefa aberta** no mesmo projeto, ignorando acento, maiúsculas e espaços. A criação é recusada com `possible_duplicate` e o id da existente. A interface pergunta "criar mesmo assim?" e reenvia com `allowDuplicate: true`.

## D-011 — Excluir é excluir · [técnica] · 2026-10-20

- Ao excluir um registro, o histórico mantém a trilha (o quê e quando), mas o **conteúdo** de todas as entradas anteriores é apagado.
- Excluir uma tarefa exclui os seus lembretes.
- Excluir um projeto mantém tarefas, notas e decisões, só desfaz o vínculo.
- Excluir uma tarefa **não** exclui a captura de origem na Inbox, e vice-versa: são ações separadas e explícitas.

## D-012 — Decisões registram quem propôs · [técnica] · 2026-10-20

Uma decisão só é gravada depois de confirmada pelo usuário. O campo `proposedBy` (`user` | `sophia`) preserva a origem: uma sugestão da SOPHIA aceita nunca é atribuída ao usuário. Revisar uma decisão marca a antiga como `superseded`. Ela sai da lista vigente, mas continua no histórico.

## D-013 — Lembrete nasce "pending" · [técnica] · 2026-10-20

Criar um lembrete só o salva (`pending`). Ele só passa a `scheduled` quando o agendador (etapa 4) o assume. A interface nunca diz "agendado" antes disso.

## D-014 — Datas: errar por omissão, nunca por invenção · [técnica] · 2026-10-20

O interpretador de datas (sem IA) reconhece um conjunto fechado de expressões (`docs/05-expressoes-de-data.md`):

- **Uma leitura possível:** resolve, e toda suposição feita é mostrada ("o dia 5 deste mês já passou, considerei 05/11").
- **Mais de uma leitura razoável** ("próxima sexta", "às 3"): não escolhe; devolve as opções e a pergunta.
- **Período vago** ("semana que vem"): não inventa um dia.
- **Forma que também aparece fora de datas** ("segunda versão", "1/2 xícara", "as 3 ideias"): só reconhece com contexto claro.

A proposta de tarefa não é gravada. A gravação acontece na conversão, com o que foi confirmado. Tarefa e lembrete entram no mesmo lote atômico.

## Pendências

- [pendente] Modelo de conversa local (testar 2–3 candidatos no Mac do usuário).
- [pendente] Confirmar o EmbeddingGemma 2 no model card oficial.
- [pendente] Identidade visual da SOPHIA-LOCAL (as skills de design existentes são da SophIA comercial).
- [pendente] Categorias iniciais de ideias: usar as 8 da especificação, configuráveis.
