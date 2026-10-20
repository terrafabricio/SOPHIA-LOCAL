# SOPHIA-LOCAL — instruções para agentes

Sistema pessoal, local-first, app desktop para macOS. **Não confundir com o repositório `terrafabricio/sophia`** (produto comercial, Next.js + Supabase). As skills `sophia-master-skill`, `sophia-core-skill` e `sophia-project-structure` descrevem aquele produto e **não se aplicam aqui**.

## Antes de mexer
1. Leia `docs/04-estado-atual.md` (onde paramos) e `docs/03-plano-mvp.md` (etapas e critérios de aceite).
2. Decisões em `docs/01-decisoes.md` só mudam com um novo registro lá.

## Comandos
- `npm run check`: lint + tipos + testes. Precisa passar antes de qualquer commit.
- `npm test -w @sophia/core`: só os testes do núcleo.

## Regras do código
- Regra de negócio fica em `packages/core` (TypeScript puro, sem interface).
- Escrita no banco só por `batch` atômico (D-009). Nunca abrir transação entre chamadas.
- Erro de negócio volta como `Result` (`ok: false`); não lançar exceção.
- Toda resposta de sucesso é relida do banco, nunca montada a partir da entrada.
- Migrações publicadas são imutáveis: mudança de schema entra numa nova migração.
- Mensagens para o usuário em português; identificadores no código em inglês.
- IA 100% local (D-003): nenhum adaptador de nuvem.

## Ao encerrar uma sessão
Atualize `docs/04-estado-atual.md`: o que foi feito, testes executados (com resultado real), problemas conhecidos e próximo passo.
