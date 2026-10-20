# Estado atual — atualize ao fim de cada sessão

**Última atualização:** 2026-10-20 (sessão 2: etapas 0, 1 e 2)

## Onde estamos
Etapas 0, 1 e 2 concluídas. O núcleo `packages/core` grava, recupera e entende datas em português, com testes. **Ainda não há interface nem app desktop**: nada disso é usável por você hoje sem código.

## Concluído
**Etapa 0: fundação.** Monorepo npm workspaces; TypeScript 6 strict; Vitest 5; ESLint 10; Zod 4; CI no GitHub Actions (`npm run check` a cada push).

**Etapa 1: banco e domínio.** Schema SQLite versionado; Inbox, Tarefas, Projetos, Decisões, Notas, Lembretes, Histórico e Exportação. Detalhes nas decisões D-009 a D-013.

**Etapa 2: captura com datas (sem IA).**
- Interpretador de datas e horários em pt-BR: `src/parsing/dates-ptbr.ts`. O que ele entende, quando pergunta e o que ignora de propósito está em `docs/05-expressoes-de-data.md` (D-014).
- `proposeTask` / `proposeTaskFromInbox`: texto → proposta com título sem a data, prazo, lembrete (quando há horário), suposições e pergunta. **Não grava nada.**
- `chooseOption`: aplica a escolha do usuário a uma proposta ambígua.
- `convertInboxToTask` aceita `reminder`: tarefa e lembrete gravados no mesmo lote atômico.
- Utilitários de calendário e fuso sem dependências (`src/time/calendar.ts`), com tratamento do pulo do horário de verão.

## Testes executados
`npm run check` em 2026-10-20: lint ok, tipos ok, **128 testes passando (9 arquivos)**. CI da entrega anterior (etapas 0 e 1): verde no GitHub.

Verificações extras nesta sessão:
- **Teste adversarial** com 16 frases que não deveriam virar datas. Achou 4 falsos positivos ("1/2 xícara", "nota 10/10", "as 3 ideias", "hoje em dia"). Todos foram corrigidos e viraram testes de regressão.
- **Bugs que os testes pegaram e foram corrigidos:**
  - "sexta ou sábado" resolvia sozinho para sábado em vez de perguntar;
  - uma proposta continuava marcada como "ambígua" depois da escolha;
  - um horário inexistente no horário de verão voltava uma hora em vez de avançar.

Cenários da especificação (seção 20):

| Cenário | Situação |
|---|---|
| 1. Criar tarefa e recuperar | ✅ |
| 2. Mesma solicitação duas vezes | ✅ |
| 5. Corrigir memória | ✅ (notas) |
| 6. Excluir informação | ✅ (índices de busca ainda não existem) |
| 7. Decisão anterior | ✅ |
| 9. Prazo ambíguo | ✅ pergunta com opções; a captura nunca é bloqueada |
| 10. Falha parcial | ✅ inclusive tarefa + lembrete |
| 12. Reiniciar aplicação | ✅ |

Pendentes: 3 (lembrete com app fechado: etapas 4 e 5), 4 e 15 (IA ou integração indisponível: etapa 7), 8 (busca semântica: etapa 8), 11, 13 e 14 (resumo, sobrecarga e retomada: etapa 3).

## Problemas conhecidos
- `node:sqlite` emite `ExperimentalWarning` no Node 22. Ele só é usado nos testes.
- O adaptador de banco do app ainda não existe (risco R-08).
- O fuso do usuário é passado como parâmetro. Ainda não existe tela de configurações para guardá-lo; o app usará o fuso do sistema.
- Limitações do interpretador de datas listadas em `docs/05-expressoes-de-data.md` (intervalos, "depois do almoço", feriados).
- `docs/00-especificacao.md` ainda não foi salvo (falta o texto original).

## Próximo passo recomendado
**Etapa 3: regras.** Próxima ação recomendada (com motivo visível), no máximo 3 prioridades, o que vence hoje, projetos parados ou sem próximo passo, e o resumo de retomada (onde paramos, concluído, pendente, bloqueio, próximo passo). Cobre os cenários 11, 13 e 14.

Depois: **etapa 4** (agendador de lembretes: disparo, recuperação após reinício, anti-duplicata). As duas não dependem do Mac.
