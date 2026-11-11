// Avisos internos da clínica vindos do PEPMH (pagamento enviado/confirmado, consulta cancelada, paciente novo).
// Chegam em POST /api/avisar e vão para o WhatsApp da MH. Se o WhatsApp estiver desconectado,
// ficam numa fila no volume (data/avisos-pendentes.jsonl) e saem assim que a conexão voltar.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const agente = require('./agente');

const FILA = path.join(config.DATA_DIR, 'avisos-pendentes.jsonl');
const destino = () => config.AVISOS_PARA || config.NUMERO_AGENTE;

function lerFila() {
  try { return fs.readFileSync(FILA, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function gravarFila(itens) {
  fs.mkdirSync(path.dirname(FILA), { recursive: true });
  fs.writeFileSync(FILA, itens.map((i) => JSON.stringify(i)).join('\n') + (itens.length ? '\n' : ''));
}

async function avisar(texto) {
  const t = String(texto || '').trim().slice(0, 3000);
  if (!t) throw new Error('Texto vazio.');
  try {
    await agente.enviar(destino(), t);
    return { enviado: true };
  } catch (e) {
    const fila = lerFila(); fila.push({ texto: t, em: new Date().toISOString() }); gravarFila(fila.slice(-500));
    console.log('[avisos] WhatsApp indisponível, aviso guardado na fila:', e.message);
    return { enviado: false, naFila: true };
  }
}

let ocupado = false;
async function esvaziarFila() {
  if (ocupado || agente.status().estado !== 'conectado') return;
  ocupado = true;
  try {
    let fila = lerFila();
    while (fila.length) {
      const item = fila[0];
      const quando = new Date(item.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      await agente.enviar(destino(), `${item.texto}\n(aviso de ${quando}, enviado quando o WhatsApp voltou)`);
      fila = fila.slice(1); gravarFila(fila);
    }
  } catch (e) {
    console.log('[avisos] falha ao esvaziar a fila:', e.message);
  } finally { ocupado = false; }
}
setInterval(esvaziarFila, 30000).unref();

module.exports = { avisar, esvaziarFila, pendentes: () => lerFila().length };
