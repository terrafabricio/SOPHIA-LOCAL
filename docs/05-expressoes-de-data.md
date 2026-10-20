# Expressões de data e horário reconhecidas (sem IA)

Implementação: `packages/core/src/parsing/dates-ptbr.ts`. Testes: `packages/core/test/dates-ptbr.test.ts`.

**Princípio (D-014):** errar por omissão é melhor que errar por invenção. Uma data que a SOPHIA não reconhece fica sem prazo, e você define depois. Uma data reconhecida errada vira um prazo ou lembrete falso. Por isso, na dúvida, ela não reconhece ou pergunta.

Exemplos considerando **terça-feira, 20/10/2026, 09:00** em São Paulo.

## Datas

| Você escreve | Resultado |
|---|---|
| hoje · amanhã · depois de amanhã | 20/10 · 21/10 · 22/10 |
| daqui a 3 dias · em duas semanas | 23/10 · 03/11 |
| até o fim do mês | 31/10 |
| sexta · na sexta · até sexta-feira · no sábado | próxima ocorrência: 23/10, 24/10 |
| próxima terça | 27/10 (hoje é terça, então é a da semana que vem) |
| semana que vem na quarta | 28/10 |
| dia 25 · para o dia 25 | 25/10 |
| dia 5 | 05/11 (*suposição dita: "o dia 5 deste mês já passou"*) |
| 25/12 · 25 de dezembro · 30/11/26 | 25/12/2026 · 25/12/2026 · 30/11/2026 |
| 10/01 · 2 de março | 2027 (*suposição dita: "já passou este ano"*) |
| 15/03/2025 | aceito, com aviso: "essa data já passou" |

## Horários

| Você escreve | Resultado |
|---|---|
| às 14h · 14h30 · às 9:15 | 14:00 · 14:30 · 09:15 |
| às 3 da tarde · 8 da noite · meio-dia | 15:00 · 20:00 · 12:00 |
| às 15 · às 15 horas | 15:00 |
| daqui a 30 minutos · em 2 horas · daqui a meia hora | agora + intervalo |
| às 14h (sem dia) | hoje, se ainda não passou; senão amanhã (*suposição dita*) |

Quando há horário, a proposta inclui um **lembrete**. Sem horário, só o prazo.

## Quando a SOPHIA pergunta (cenário 9)

| Você escreve | Pergunta | Opções |
|---|---|---|
| próxima sexta | Qual destas datas? | sex 23/10 · sex 30/10 |
| reunião na terça (dito numa terça) | Qual destas datas? | hoje · 27/10 |
| amanhã às 3 | Qual destes horários? | 03:00 · 15:00 |
| sexta ou sábado | Qual destas datas? | 23/10 · 24/10 |

A captura **nunca** é bloqueada pela pergunta: o texto já está salvo na Inbox.

## Períodos vagos (não viram data)

semana que vem · próxima semana · mês que vem · fim de semana · em breve · qualquer dia · um dia desses

Esses textos ficam sem prazo, com a nota "não define um dia". "Semana que vem às 14h" também fica vago.

## O que NÃO é reconhecido de propósito

| Texto | Por quê |
|---|---|
| segunda versão do site · quinta parte | "segunda", "quinta" e "sexta" também são ordinais. O dia da semana só conta com contexto ("na sexta", "sexta-feira", fim da frase, "sexta às 14h") |
| 1/2 xícara · nota 10/10 | `dd/mm` sem ano só conta com contexto de data: "dia", "até", "prazo", "vence", "entrega" ou fim da frase |
| as 3 ideias principais | "as" sem acento também é artigo. Só conta como horário com "horas" ou no fim da frase |
| reunião de 2h · leva 2h | duração, não horário |
| hoje em dia | expressão idiomática |
| 31/02 · dia 40 | data impossível |

## Limitações conhecidas

- Intervalos ("de 14h às 16h", "entre segunda e quarta") não são tratados como intervalo.
- Datas por extenso com ano escrito ("dois mil e vinte e sete") não são reconhecidas.
- Feriados e expressões como "depois do almoço" ou "no fim da tarde" não são reconhecidos.
- A interpretação por IA (etapa 7) poderá cobrir mais casos. Mesmo assim, a resposta da IA vai passar pela validação e pela confirmação.
