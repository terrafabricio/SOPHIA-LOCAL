# Investigação dos componentes de IA

Data: 2026-10-09. Cada afirmação traz a fonte. O que não foi confirmado está marcado como tal.

---

## 1. Laya

**Fontes:** <https://laya.aay.sh/> (site oficial) e <https://github.com/aayushch/laya> (repositório).

### O que é (confirmado)

- **Um app desktop de código aberto.** Não é um modelo de IA, uma biblioteca ou um framework de agentes.
- **Função:** reúne notificações de ferramentas de trabalho (Gmail, Slack, Jira, GitHub), usa um LLM para pesquisar cada item e gera "cartões de ação" com respostas sugeridas. Segundo o site, "nothing is sent or changed on your behalf without your explicit approval".
- **Licença:** Apache-2.0.
- **Stack:** Tauri v2 (Rust), Svelte 5 + Tailwind v4 e um motor em Python 3.10+ com FastAPI.
- **Plataformas:** macOS (`.dmg` universal, Apple Silicon + Intel), Windows e Linux.
- **Dados:** tudo local. SQLite em `~/.laya/data/laya.db`, ChromaDB em `~/.laya/data/chroma/` e chaves de API no keychain do sistema.
- **Modelos:** Ollama ou LM Studio (locais), Claude, GPT ou Gemini (chaves do usuário) e endpoints compatíveis com OpenAI via LiteLLM.
- **Integração:**
  - API REST local com `Authorization: Bearer <token>`. O README diz que o WebSocket `/ws` "not authenticated yet".
  - O site cita um servidor MCP em `http://127.0.0.1:8420/mcp/`. **Não confirmado no README.**
- **Maturidade na data da consulta:** cerca de 636 estrelas, 410 commits e 12 issues abertas.

### O que não foi confirmado

- Versão atual e data do último release.
- Ferramentas expostas pelo servidor MCP e formato da API REST.
- Requisitos de hardware.

### Conclusão

O Laya resolve um problema **vizinho**: a triagem da caixa de entrada de trabalho. Ele não substitui nenhuma camada da SOPHIA (orquestrador, memória, modelo de linguagem).

**Papel recomendado:** integração futura opcional, como fonte de entrada. Fora do MVP (decisão D-005).

**Atenção para privacidade (D-003):** se o Laya estiver configurado com um provedor de nuvem, os dados que ele processa saem da máquina. A SOPHIA não controla isso. Se integrarmos no futuro, a documentação deve deixar isso explícito.

---

## 2. EmbeddingGemma 2

**Situação:** lançado em 2026-10-06, três dias antes desta investigação. **Só foram encontradas fontes secundárias.** O model card oficial no Hugging Face e o post do Google ainda não foram lidos.

### O que as fontes secundárias relatam (a confirmar)

| Item | Relato | Fonte |
|---|---|---|
| Licença | Apache 2.0 | [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/21252/embeddinggemma-2-google-open-multimodal-embeddings), [aiweekly](https://aiweekly.co/fr/alerts/google-publie-embeddinggemma-2-modle-multimodal-de-740-m-sous-apache-20-191-mo) |
| Modalidades | texto, código, imagem, vídeo e áudio num espaço único | idem, [fonearena](https://www.fonearena.com/blog/494313/google-embeddinggemma-2.html) |
| Tamanho | ~740M no total (texto 270M, visão 170M, áudio 300M); dá para carregar só o encoder de texto | idem |
| Dimensões | 768, com truncagem Matryoshka para 512, 256 ou 128 | idem |
| Contexto | 8K tokens | idem |
| RAM | ~191 MB só texto (quantizado); ~567 MB completo | idem |
| Ferramentas | llama.cpp, Ollama, vLLM, LiteRT, MediaPipe | [llmreference](https://www.llmreference.com/model/embeddinggemma-2) |

Referência da versão 1 (fonte oficial): [Google Developers Blog — Introducing EmbeddingGemma](https://developers.googleblog.com/introducing-embeddinggemma/).

### Verificações obrigatórias antes de implementar

1. Ler o model card oficial: dimensões, prompts de tarefa (consulta e documento), licença e termos.
2. Confirmar o nome exato do modelo no Ollama e se o encoder de texto pode ser usado sozinho.
3. Testar no Mac do usuário: tempo de embedding de uma nota curta e uso de RAM.
4. Gravar em cada vetor o modelo, a versão e a dimensão. **Vetores da versão 1 e da versão 2 não são intercambiáveis.**

### Papel na arquitetura

- Busca semântica em memórias, decisões, notas de projeto e caixa de entrada.
- **Não é** modelo de conversa nem de raciocínio: só gera vetores.
- **Índice:** no volume de um uso pessoal (milhares de itens), dá para comparar todos os vetores em TypeScript, sem extensão de banco. Reavaliar se passar de ~50 mil itens.
- **Fallback:** se o modelo estiver indisponível, a busca textual (SQLite FTS5) continua funcionando. O resultado indica que a busca semântica não foi usada.

---

## 3. Modelo de conversa e planejamento (geração de texto)

- **Requisito (D-003):** local, via Ollama, em um Mac com 16 GB.
- **Faixa viável:** ~7–12B parâmetros quantizado em 4 bits, deixando memória para o sistema, o app e os embeddings.
- **Uso no MVP:** interpretar texto livre em uma **intenção estruturada** (criar tarefa, criar lembrete, registrar ideia, etc.), validada por Zod, e gerar resumos curtos. Não executa operações por conta própria.
- **Escolha:** não definida. Testar 2–3 candidatos disponíveis no Ollama no Mac do usuário, com um conjunto fixo de 20–30 frases reais em português, medindo três coisas: JSON válido, intenção correta e tempo de resposta.

---

## 4. Ambiente de desenvolvimento × ambiente de uso

| | Onde | O que dá para validar |
|---|---|---|
| Desenvolvimento por IA | Container Linux na nuvem (4 CPUs, 15 GB, sem GPU) | Núcleo TypeScript, banco SQLite, regras e testes automatizados |
| Uso real | Mac do usuário | App Tauri, notificações do macOS, atalho global, Ollama e modelos |

Consequência: tudo que depende do macOS (notificações, barra de menus, inicialização com o sistema) precisa de **teste manual no Mac do usuário** e será marcado como "não verificado" até lá.
