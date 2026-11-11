// Conexão WhatsApp própria via Baileys (protocolo WhatsApp Web), sem
// intermediário pago. Pareamento: na primeira vez, um QR é gerado em
// data/wa-qr.png, escaneie com o WhatsApp do número da clínica
// (Aparelhos conectados → Conectar aparelho). A sessão fica salva em
// data/wa-session/ e reconecta sozinha depois.
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const config = require('./config');

const SESSION_DIR = path.join(config.DATA_DIR, 'wa-session');
const QR_PATH = path.join(config.DATA_DIR, 'wa-qr.png');

let sock = null;
let estado = 'desconectado'; // desconectado | pareando | conectado
let onMessage = null;
let tentando = false;
let reconnectTimer = null;
let qrGeradoEm = null;
let ultimoErro = null;

function proxyAgent() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return undefined;
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(proxy);
  } catch {
    return undefined;
  }
}

function jidDe(numero) {
  return `${String(numero || '').replace(/\D/g, '')}@s.whatsapp.net`;
}
function numeroDe(jid) {
  return String(jid || '').split('@')[0].replace(/\D/g, '');
}
function textoDe(m) {
  return (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
}

async function gerarQR(qr) {
  estado = 'pareando';
  qrGeradoEm = new Date().toISOString();
  fs.mkdirSync(path.dirname(QR_PATH), { recursive: true });
  await QRCode.toFile(QR_PATH, qr, { width: 512, margin: 2 });
  console.log(`[agente] QR atualizado em ${qrGeradoEm} (${QR_PATH}) — escaneie com o WhatsApp do número ${config.NUMERO_AGENTE}.`);
}

function limparQR() {
  qrGeradoEm = null;
  try { fs.unlinkSync(QR_PATH); } catch {}
}

function encerrarSocket(atual) {
  if (!atual) return;
  try { atual.ev.removeAllListeners(); } catch {}
  try { atual.ws?.close(); } catch {}
  try { atual.end?.(undefined); } catch {}
}

async function conectar() {
  if (tentando) return;
  tentando = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }

    const atual = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      agent: proxyAgent(),
    });
    sock = atual;
    ultimoErro = null;

    atual.ev.on('creds.update', saveCreds);
    atual.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (atual !== sock) return;
      if (qr) {
        try { await gerarQR(qr); } catch (e) { console.error('[agente] falha ao salvar QR:', e.message); }
      }
      if (connection === 'open') {
        estado = 'conectado';
        tentando = false;
        ultimoErro = null;
        limparQR();
        console.log('[agente] WhatsApp conectado ✓');
      }
      if (connection === 'close') {
        if (atual !== sock) return;
        estado = 'desconectado';
        tentando = false;
        const err = lastDisconnect?.error;
        const code = err?.output?.statusCode || err?.statusCode;
        ultimoErro = err?.message || (code ? `Código ${code}` : 'Conexão fechada');
        const deslogado = code === DisconnectReason.loggedOut;
        console.log(`[agente] conexão fechada (código ${code || '?'})${deslogado ? ' — sessão inválida, limpando para novo pareamento' : ' — reconectando...'}`);
        if (deslogado) {
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
          limparQR();
        }
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => { reconnectTimer = null; conectar(); }, deslogado ? 3000 : 8000);
      }
    });
    atual.ev.on('messages.upsert', async ({ messages, type }) => {
      if (atual !== sock || type !== 'notify' || !onMessage) return;
      for (const m of messages) {
        try { await onMessage(m, atual); } catch (e) { console.error('[agente] erro ao processar mensagem:', e.message); }
      }
    });
  } catch (e) {
    tentando = false;
    ultimoErro = e.message;
    console.error('[agente] falha ao conectar:', e.message);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; conectar(); }, 15000);
  }
}

async function enviar(numero, texto) {
  if (!sock || estado !== 'conectado') throw new Error('Agente WhatsApp não conectado.');
  await sock.sendMessage(jidDe(numero), { text: texto });
  return 'enviado';
}

function iniciar(handleMessage) {
  onMessage = handleMessage;
  limparQR();
  conectar();
}

async function requestPairingCode(numero) {
  const dig = String(numero || '').replace(/\D/g, '');
  if (dig.length < 10) throw new Error('Número inválido. Use DDI+DDD+número, só dígitos.');
  if (!sock) throw new Error('Agente não iniciado. Aguarde o serviço iniciar e tente de novo.');
  if (estado === 'conectado') throw new Error('O WhatsApp já está conectado.');
  return sock.requestPairingCode(dig);
}

function reconnect() {
  const antigo = sock;
  sock = null;
  tentando = false;
  estado = 'desconectado';
  ultimoErro = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  encerrarSocket(antigo);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; conectar(); }, 1000);
  return true;
}

function resetSession() {
  const antigo = sock;
  sock = null;
  tentando = false;
  estado = 'desconectado';
  ultimoErro = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  encerrarSocket(antigo);
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
  limparQR();
  reconnectTimer = setTimeout(() => { reconnectTimer = null; conectar(); }, 1000);
  return true;
}

function status() {
  const qrDisponivel = fs.existsSync(QR_PATH);
  return {
    estado,
    numeroAgente: config.NUMERO_AGENTE,
    qrDisponivel,
    qrPath: QR_PATH,
    qrGeradoEm: qrDisponivel ? qrGeradoEm : null,
    ultimoErro,
  };
}

module.exports = { iniciar, enviar, status, reconnect, resetSession, requestPairingCode, textoDe, numeroDe, jidDe, QR_PATH };
