# SOPHIA-LOCAL

**Sistema Operacional Pessoal Humanizado de Inteligência Artificial.** Um app desktop para macOS, local-first, que ajuda a transformar pensamentos, intenções e ideias em decisões, tarefas e resultados, reduzindo a carga mental.

> Estado: núcleo de dados pronto e testado (etapas 0 e 1). Ainda sem interface. Veja `docs/04-estado-atual.md`.

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run check   # lint + tipos + testes
```

| Pasta | Conteúdo |
|---|---|
| `packages/core` | Domínio, regras e persistência (TypeScript puro, sem interface) |
| `docs/` | Decisões, investigação, plano e estado atual |

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/01-decisoes.md`](docs/01-decisoes.md) | Decisões tomadas, com motivo e data |
| [`docs/02-investigacao-ia.md`](docs/02-investigacao-ia.md) | Laya, EmbeddingGemma 2 e modelo local: o que foi verificado |
| [`docs/03-plano-mvp.md`](docs/03-plano-mvp.md) | Arquitetura, critérios de aceite da v0.1, etapas e riscos |
| [`docs/04-estado-atual.md`](docs/04-estado-atual.md) | Onde paramos e o próximo passo |

## Princípios em uma linha

Confiável antes de inteligente · local por padrão · nunca afirmar o que não foi executado · a organização é trabalho do sistema, não do usuário.
