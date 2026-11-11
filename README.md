# Agente de WhatsApp da clínica — MH Cuidar / Dra. Mayara Miranda

Atende clientes no WhatsApp do número **+55 75 98108-9146**.

## O que ele faz

1. **Agendar consulta na Clínica Única** (Dra. Mayara): Maraclin, Santa Casa de São Félix ou online. Consulta a disponibilidade real na API, mostra os horários livres, confirma com a paciente e grava o agendamento com `canal: whatsapp`.
2. **MH Cuidar em Muritiba**: não tem API pública para reservar direto, então o agente manda o link oficial de agendamento (PEPMH), com endereço e telefone.
3. **Ver minhas consultas**, **horários e endereços**, **remarcação** e **falar com atendente**. Remarcação e pedido de atendente vão para a fila `data/atendimento-pendente.jsonl`, para a clínica responder.
4. **Não inventa nada**: sem preço (o valor é informado pela clínica), sem diagnóstico (sintoma, exame e remédio vão para consulta), sem cancelar (a política da clínica é sem cancelamento pela página; remarcação vai para a equipe).

## Como funciona

- Conexão própria via Baileys (WhatsApp Web), mesmo padrão do agente de plantões do `mhcuidar-plantoes`. Sem custo por mensagem.
- Regras primeiro; Gemini Lite (`gemini-3.5-flash-lite`) só para entender texto livre quando as regras não classificam, com cache e parada imediata em 429. Sem `GEMINI_API_KEY`, funciona só com regras e menu. Só Gemini, nunca OpenAI.
- Sessão do WhatsApp em `data/wa-session/` (volume na Railway). QR de pareamento em `data/wa-qr.png` e em `GET /qr.png`.

## Rodar local

```bash
npm install
cp .env.example .env
npm test        # fluxo sem WhatsApp e sem Gemini
npm start       # porta 3108, gera o QR em data/wa-qr.png
```

Pareamento: escaneie o QR com o WhatsApp do número +55 75 98108-9146 (Aparelhos conectados → Conectar aparelho), ou use `POST /api/pareamento` com o número para receber o código de 8 caracteres.

## Endpoints

- `GET /health` — versão, estado do WhatsApp, IA e API da clínica.
- `GET /status` — estado da conexão e se a URL do Facebook está configurada.
- `GET /qr.png` — QR de pareamento, quando disponível (sem cache; sempre recarregue a imagem).
- `POST /api/reconectar` — reinicia a conexão.
- `POST /api/limpar-sessao` — apaga a sessão salva e força um novo pareamento (útil se o QR/código não conclui).
- `POST /api/pareamento` — `{ "numero": "5575981089146" }` devolve o código de 8 dígitos.

## Pareamento (QR ou código)

1. Confirme que o **celular com o chip do número do agente (+55 75 98108-9146)** está com internet e WhatsApp atualizado.
2. Abra `/qr.png?t=1` (ou adicione um número diferente a cada tentativa) e escaneie em **Aparelhos conectados → Conectar aparelho**. O QR expira/renova rápido — se demorar, recarregue a imagem e escaneie o novo.
3. Se o QR não concluir, tente o código: `POST /api/pareamento` e digite os 8 caracteres em **Aparelhos conectados → Conectar aparelho → Conectar com número de telefone**.
4. Se falhar repetidamente, limpe a sessão e gere um QR novo: `POST /api/limpar-sessao` e escaneie novamente.
5. Em hospedagem (Railway), use **volume persistente em `/app/data`**. Sem volume, a sessão se perde a cada deploy e será preciso parear de novo.

> Observação: este projeto usa uma correção do Baileys para o fluxo de pareamento (`companion_reg_refresh`) que pode impedir a conclusão do QR/código nas versões rc atuais.

## Variáveis

| Variável | Padrão |
| --- | --- |
| `CLINICA_API_URL` | https://clinica-unica-production.up.railway.app |
| `NUMERO_AGENTE` | 5575981089146 |
| `MH_CUIDAR_LINK` | https://pepmh-web-production.up.railway.app/#/agendar/mhcuidar |
| `FACEBOOK_URL` | https://www.facebook.com/people/Mhcuidar/61596125085494/ |
| `GEMINI_API_KEY` | vazio (opcional) |
| `AVISOS_TOKEN` | chave dos avisos do PEPMH (mín. 24 caracteres; sem ela, `/api/avisar` recusa tudo) |
| `AVISOS_PARA` | número que recebe os avisos (vazio = o próprio WhatsApp da MH, conversa "mensagem para si") |
| `DATA_DIR` | `data/` local, `/app/data` na Railway (volume) |

## Deploy

Railway, com volume em `/app/data` para a sessão do WhatsApp não se perder a cada deploy. Sem volume, o pareamento precisa ser refeito após cada redeploy.
