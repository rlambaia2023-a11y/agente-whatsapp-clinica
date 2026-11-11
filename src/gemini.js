// Entendimento de texto livre com Gemini Lite, só quando as regras não bastam.
// Disciplina de cota: modelo Lite primeiro, cache por texto, parada imediata
// em 429, sem retry e sem trocar de modelo para contornar o limite.
const config = require('./config');

const cache = new Map(); // texto -> { resposta, em }
let paradoPorCota = false;

const PROMPT = `Você classifica a mensagem de uma paciente da clínica MH Cuidar / Dra. Mayara Miranda (ginecologia e obstetrícia).
Responda SÓ com JSON, sem texto fora dele, neste formato:
{"intencao":"agendar|mh_cuidar|minhas_consultas|horarios|endereco|valores|remarcar|atendente|duvida_clinica|saudacao|outro","local":"maraclin|santa-casa-sao-felix|online|muritiba|","data":"AAAA-MM-DD ou vazio","periodo":"manha|tarde|"}
Regras: "muritiba" ou "MH Cuidar" é intencao mh_cuidar. Pergunta de sintoma, exame, remédio ou diagnóstico é duvida_clinica. Preço ou valor é valores. Sem data clara, deixe data vazia. Nunca invente data, local ou horário.
Mensagem: `;

async function classificar(texto) {
  const chave = texto.trim().toLowerCase();
  if (cache.has(chave)) return cache.get(chave).resposta;
  if (!config.GEMINI_API_KEY || paradoPorCota) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT + JSON.stringify(texto) }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200 },
        }),
      },
    );
    if (r.status === 429) {
      paradoPorCota = true;
      console.error('[gemini] cota esgotada (429) — IA pausada, o agente segue só com regras.');
      return null;
    }
    if (!r.ok) {
      console.error(`[gemini] erro HTTP ${r.status} — seguindo só com regras.`);
      return null;
    }
    const j = await r.json();
    const bruto = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const ini = bruto.indexOf('{');
    const fim = bruto.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return null;
    const parsed = JSON.parse(bruto.slice(ini, fim + 1));
    if (cache.size > 200) cache.clear();
    cache.set(chave, { resposta: parsed, em: Date.now() });
    return parsed;
  } catch (e) {
    console.error('[gemini] falha:', e.message);
    return null;
  }
}

function status() {
  return { modelo: config.GEMINI_MODEL, configurada: Boolean(config.GEMINI_API_KEY), paradaPorCota: paradoPorCota, cache: cache.size };
}

module.exports = { classificar, status };
