// Conexão WhatsApp própria via Baileys (protocolo WhatsApp Web), sem
// intermediário pago. Pareamento: na primeira vez, um QR é gerado em
// data/wa-qr.png, escaneie com o WhatsApp do número da clínica
// (Aparelhos conectados → Conectar aparelho). A sessão fica salva em
// data/wa-session/ e reconecta sozinha depois. Adaptado do agente de
// plantões do mhcuidar-plantoes, que já usa este mesmo padrão.
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const config = require('./config');

const SESSION_DIR = path.join(config.DATA_DIR, 'wa-session');
const QR_PATH = path.join(config.DATA_DIR, 'wa-qr.png');

let sock = null;
let estado = 'desconectado'; // desconectado | pareando | conectado
let onMessage = null;
let tentando = false;

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
  fs.mkdirSync(path.dirname(QR_PATH), { recursive: true });
  await QRCode.toFile(QR_PATH, qr, { width: 512, margin: 2 });
  console.log(`[agente] QR de pareamento gerado em ${QR_PATH} — escaneie com o WhatsApp do número ${config.NUMERO_AGENTE}.`);
}

async function conectar() {
  if (tentando) return;
  tentando = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['mhcuidar-clinica', 'agente', '1.0'],
      syncFullHistory: false,
      agent: proxyAgent(),
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) await gerarQR(qr);
      if (connection === 'open') {
        estado = 'conectado';
        tentando = false;
        try { fs.unlinkSync(QR_PATH); } catch {}
        console.log('[agente] WhatsApp conectado ✓');
      }
      if (connection === 'close') {
        estado = 'desconectado';
        tentando = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const deslogado = code === DisconnectReason.loggedOut;
        console.log(`[agente] conexão fechada (código ${code})${deslogado ? ' — sessão inválida, gere novo QR' : ' — tentando reconectar...'}`);
        if (deslogado) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        setTimeout(() => { tentando = false; conectar(); }, deslogado ? 5000 : 8000);
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !onMessage) return;
      for (const m of messages) {
        try { await onMessage(m, sock); } catch (e) { console.error('[agente] erro ao processar mensagem:', e.message); }
      }
    });
  } catch (e) {
    tentando = false;
    console.error('[agente] falha ao conectar:', e.message);
    setTimeout(conectar, 15000);
  }
}

async function enviar(numero, texto) {
  if (!sock || estado !== 'conectado') throw new Error('Agente WhatsApp não conectado.');
  await sock.sendMessage(jidDe(numero), { text: texto });
  return 'enviado';
}

function iniciar(handleMessage) {
  onMessage = handleMessage;
  conectar();
}

async function requestPairingCode(numero) {
  const dig = String(numero || '').replace(/\D/g, '');
  if (dig.length < 10) throw new Error('Número inválido. Use DDI+DDD+número, só dígitos.');
  if (!sock) throw new Error('Agente não iniciado.');
  return sock.requestPairingCode(dig);
}

function reconnect() {
  try { sock?.ws?.close(); } catch {}
  try { sock?.end?.(); } catch {}
  sock = null;
  tentando = false;
  estado = 'desconectado';
  setTimeout(conectar, 1000);
  return true;
}

function status() {
  return { estado, numeroAgente: config.NUMERO_AGENTE, qrDisponivel: fs.existsSync(QR_PATH), qrPath: QR_PATH };
}

module.exports = { iniciar, enviar, status, reconnect, requestPairingCode, textoDe, numeroDe, jidDe, QR_PATH };
