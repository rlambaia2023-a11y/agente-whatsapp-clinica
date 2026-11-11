// Bot de conversa com clientes: recebe a mensagem do WhatsApp, passa pelo
// fluxo e responde. Só atende conversas 1 a 1; ignora grupos, status e as
// mensagens que o próprio agente enviou.
const fs = require('fs');
const path = require('path');
const agente = require('./agente');
const fluxo = require('./fluxo');
const clinica = require('./clinica');
const config = require('./config');

const sessoes = new Map(); // remoteJid -> sessão do fluxo
const FILA = path.join(config.DATA_DIR, 'atendimento-pendente.jsonl');

function registrarAtendimento(item) {
  const linha = JSON.stringify({ ...item, em: new Date().toISOString() });
  fs.mkdirSync(path.dirname(FILA), { recursive: true });
  fs.appendFileSync(FILA, linha + '\n');
  console.log('[atendimento]', linha);
  return Promise.resolve();
}

function sessaoDe(jid) {
  if (!sessoes.has(jid)) sessoes.set(jid, fluxo.novaSessao());
  return sessoes.get(jid);
}

async function handleMessage(m, sock) {
  if (!sock) return;
  const jid = m.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) return;
  if (m.key.fromMe) return;
  const texto = agente.textoDe(m);
  if (!texto) return;
  const telefone = agente.numeroDe(jid);
  const sessao = sessaoDe(jid);
  const respostas = await fluxo.processar(sessao, texto, { telefone, clinica, registrarAtendimento });
  for (const r of respostas) {
    await sock.sendMessage(jid, { text: r });
  }
}

function iniciar() {
  agente.iniciar(handleMessage);
}

module.exports = { iniciar, handleMessage, registrarAtendimento };
