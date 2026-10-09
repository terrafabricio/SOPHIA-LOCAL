# Plano do MVP — SOPHIA-LOCAL

Pergunta-guia: *isso torna a SOPHIA mais confiável, mais útil, mais simples de usar ou mais capaz de transformar intenções em resultados?*

---

## 1. Arquitetura mínima

```
┌──────────────────────────────────────────────────────────────┐
│  apps/desktop  (Tauri v2 + React + TS)                       │
│  Barra de menus · atalho global de captura · janelas         │
│  Painel "Agora" · Inbox · Tarefas · Projetos · Lembretes     │
│  → só apresenta e chama o núcleo; sem regra de negócio       │
└───────────────┬──────────────────────────────────────────────┘
                │ chamadas tipadas
┌───────────────▼──────────────────────────────────────────────┐
│  packages/core  (TypeScript puro, testável sem o app)        │
│                                                              │
│  orchestrator/   texto → intenção → validação → confirmação  │
│  intents/        esquemas Zod das intenções + executor       │
│  domain/         Inbox, Tarefa, Projeto, Decisão, Lembrete,  │
│                  Memória, Histórico (auditoria)              │
│  rules/          prioridade, próxima ação, prazos,           │
│                  projetos parados, retomada                  │
│  scheduler/      máquina de estados dos lembretes,           │
│                  recuperação após reinício, anti-duplicata   │
│  ai/ (portas)    TextGenerator · Embedder                    │
│  storage/(porta) Repositório + transações                    │
└───────┬──────────────────────────────┬───────────────────────┘
        │                              │
┌───────▼─────────────┐      ┌─────────▼──────────────────────┐
│ SQLite local        │      │ Ollama (localhost, opcional)   │
│ migrações + FTS5    │      │ modelo de conversa (D-003)     │
│ vetores em tabela   │      │ EmbeddingGemma 2 (D-006)       │
└─────────────────────┘      └────────────────────────────────┘
```

### Fluxo de uma solicitação

1. O usuário escreve: *"Preciso resolver o domínio da empresa amanhã."*
2. O **orquestrador** tenta interpretar:
   - com Ollama ligado, o modelo devolve uma intenção em JSON;
   - sem Ollama, entra o interpretador determinístico (datas como "amanhã" ou "sexta 14h"; o resto vai para a Inbox).
3. A intenção é **validada por Zod**. Se for inválida ou ambígua num ponto que afete a execução (por exemplo, prazo), a SOPHIA pede esclarecimento. A captura **nunca** é bloqueada: na dúvida, o texto vai para a Inbox.
4. Ações que alteram dados aparecem como **proposta**: "Vou criar a tarefa X com prazo Y. Confirmar?" Captura simples na Inbox não pede confirmação.
5. O **executor** grava numa transação, com chave de idempotência, e registra no histórico.
6. A resposta ao usuário é montada **a partir do que está no banco**, nunca a partir do texto do modelo.

### Estados de toda ação

`proposta → confirmada → executada | falhou`

### Lembretes (o ponto mais delicado)

**Estados:** `criado → programado → disparado (enviado ao macOS) → visto*`, com saídas para `adiado`, `cancelado` e `falhou`.

\* O estado "visto" só é registrado se o macOS informar. Caso contrário, fica em "disparado".

**Garantias:**
- O agendador roda enquanto o app está na barra de menus (janela fechada não encerra o app).
- O app abre junto com o sistema (configurável).
- Ao iniciar, procura lembretes vencidos que não dispararam e mostra **"Perdidos enquanto a SOPHIA estava fechada"**. Nunca dispara em silêncio nem finge que avisou na hora.
- Anti-duplicata: cada disparo é registrado atomicamente antes de notificar.
- Fuso horário salvo junto com cada lembrete. Recorrência calculada pelo núcleo.

---

## 2. Primeira entrega (v0.1): critérios de aceite

A v0.1 está pronta quando **todos** os itens abaixo forem verdadeiros e tiverem evidência (teste automatizado ou teste manual registrado no Mac).

### Dor 2: ideias soltas se perdem
- [ ] Atalho global abre a captura de qualquer app; texto salvo na Inbox com Enter.
- [ ] A captura não exige categoria, data ou projeto.
- [ ] Um item da Inbox vira tarefa, projeto ou nota em no máximo 2 cliques, ou é arquivado.

### Dor 1: esquecer compromissos
- [ ] Criar lembrete com data e hora; notificação nativa do macOS aparece com a janela fechada (app na barra de menus).
- [ ] App encerrado e reaberto: lembretes futuros continuam programados e os vencidos aparecem como "perdidos".
- [ ] O mesmo lembrete nunca notifica duas vezes.
- [ ] Reagendar e cancelar funcionam e ficam no histórico.

### Dor 4: não saber por onde começar
- [ ] O painel "Agora" mostra **uma** próxima ação recomendada, com o motivo visível ("vence hoje", "desbloqueia X"…).
- [ ] Mostra o que vence hoje e no máximo 3 prioridades. O resto fica recolhido.
- [ ] Tarefa atrasada aparece como "replanejar", sem tom de cobrança.

### Dor 3: perder o fio dos projetos
- [ ] Projeto com objetivo, estado, próximo passo, decisões e pendências.
- [ ] A tela "Retomar" mostra: onde paramos, o que foi concluído, o que está pendente, o bloqueio e o próximo passo.
- [ ] Projeto sem próximo passo ou parado há mais de N dias é sinalizado.

### Confiabilidade (transversal)
- [ ] Tudo acima funciona **com o Ollama desligado**.
- [ ] Nenhuma mensagem diz "salvei" ou "agendei" sem a operação confirmada no banco.
- [ ] Exportar todos os dados em JSON e apagar dados funcionam.
- [ ] Testes automatizados verdes para os cenários 1, 2, 5, 6, 9, 10 e 12 da especificação (seção 20).

### Fora da v0.1
- Conversa livre com o modelo local (entra na v0.2).
- Busca semântica (v0.3).
- Laya, calendários, voz e celular.

---

## 3. Etapas

Cada etapa termina com testes verdes e o arquivo `docs/04-estado-atual.md` atualizado.

| # | Etapa | Entrega verificável | Onde valida | Depende de |
|---|---|---|---|---|
| 0 | **Fundação** | Monorepo (npm workspaces), TS strict, Vitest, ESLint, CI no GitHub Actions | nuvem | — |
| 1 | **Banco e domínio** | Migrações SQLite; Inbox, Tarefa, Projeto, Decisão, Lembrete e Histórico; repositório com transações e idempotência | nuvem | 0 |
| 2 | **Captura e Inbox** | Captura → Inbox → converter/arquivar; interpretador determinístico de datas em pt-BR | nuvem | 1 |
| 3 | **Regras** | Próxima ação, prioridades, prazos, projetos parados, resumo de retomada | nuvem | 1 |
| 4 | **Agendador de lembretes** | Máquina de estados, recuperação após reinício, anti-duplicata, recorrência, fuso | nuvem (lógica) | 1 |
| 5 | **Casca desktop** | App Tauri: barra de menus, atalho global, notificações, telas Agora, Inbox, Projeto e Retomar | **Mac** | 2, 3, 4 |
| 6 | **Validação v0.1** | Roteiro de teste manual no Mac + relatório | **Mac** | 5 |
| 7 | IA local (v0.2) | Adaptador Ollama, intenção estruturada, confirmação, fallback; teste de 2–3 modelos | **Mac** | 6 |
| 8 | Busca (v0.3) | FTS5 + EmbeddingGemma 2 (após D-006), reindexação, exclusão de vetores | Mac + nuvem | 7 |

**Valor alto, risco baixo para começar:** etapas 0 e 1. Todo o resto depende delas, e dá para testá-las por completo aqui.

**Maior risco técnico:** etapa 5 (lembretes no macOS). Por isso há um **spike cedo** (R-02).

---

## 4. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-01 | Desenvolvimento acontece em Linux; app e notificações só rodam no Mac | Núcleo 100% testável fora do app; CI com runner macOS para compilar; roteiro de teste manual no Mac |
| R-02 | Timers no webview podem ser reduzidos pelo macOS com a janela oculta (App Nap), atrasando lembretes | Spike logo após a etapa 1: app mínimo com barra de menus + lembrete em 2 min com janela fechada. Se falhar, mover o relógio do agendador para Rust (pequeno; a regra continua no TS) |
| R-03 | Notificação com o app **totalmente encerrado** não é garantida | Não prometer isso. App inicia com o sistema e fica na barra de menus; perdidos aparecem ao reabrir |
| R-04 | Modelo local de ~8B pode errar intenções e datas | IA nunca executa direto: intenção validada + confirmação; interpretador determinístico de datas tem prioridade |
| R-05 | EmbeddingGemma 2 é recente; o suporte no Ollama pode estar instável | Busca textual primeiro; semântica só depois da verificação (D-006) |
| R-06 | Escopo: 4 dores + visão longa tendem a crescer | Critérios fechados da v0.1; ideias novas vão para `docs/05-futuro.md` (a criar) |
| R-07 | App sem assinatura da Apple mostra alerta do Gatekeeper | Aceitável para uso pessoal; documentar como abrir |

---

## 5. O que o usuário precisa ter no Mac (a partir da etapa 5)

- Xcode Command Line Tools: `xcode-select --install`
- Rust (rustup) e Node.js 22
- Ollama (a partir da etapa 7)

O passo a passo exato será escrito na etapa 5 e testado com o usuário.
