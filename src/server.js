// Servidor do agente de WhatsApp da clínica.
// GET /health — versão e estado, sem expor dados de paciente.
// GET /status — estado da conexão WhatsApp e da IA.
// GET /qr.png — QR de pareamento, quando disponível.
// POST /api/reconectar — reinicia a conexão (gera novo QR).
// POST /api/pareamento — { numero } devolve o código de 8 caracteres.
const http = require('http');
const fs = require('fs');
const config = require('./config');
const agente = require('./agente');
const gemini = require('./gemini');
const bot = require('./bot');

const VERSAO = '1.0.0';

function enviar(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function lerCorpo(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    return enviar(res, 200, { ok: true, servico: 'agente-whatsapp-clinica', versao: VERSAO, whatsapp: agente.status().estado, numeroAgente: config.NUMERO_AGENTE, clinicaApi: config.CLINICA_API_URL, ia: gemini.status() });
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    return enviar(res, 200, { ok: true, whatsapp: agente.status(), ia: gemini.status(), facebookUrlConfigurada: Boolean(config.FACEBOOK_URL) });
  }
  if (req.method === 'GET' && url.pathname === '/qr.png') {
    if (!fs.existsSync(agente.QR_PATH)) return enviar(res, 404, { ok: false, erro: 'Sem QR no momento. O agente pode já estar conectado.' });
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return fs.createReadStream(agente.QR_PATH).pipe(res);
  }
  if (req.method === 'POST' && url.pathname === '/api/reconectar') {
    return enviar(res, 200, { ok: agente.reconnect(), mensagem: 'Reconectando — novo QR em instantes.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/pareamento') {
    const b = await lerCorpo(req);
    try {
      const codigo = await agente.requestPairingCode(b.numero || config.NUMERO_AGENTE);
      return enviar(res, 200, { ok: true, codigo });
    } catch (e) {
      return enviar(res, 400, { ok: false, erro: e.message });
    }
  }
  return enviar(res, 404, { ok: false, erro: 'Rota não encontrada.' });
});

server.listen(config.PORT, () => {
  console.log(`Agente WhatsApp da clínica v${VERSAO} em http://localhost:${config.PORT}`);
  if (process.env.DISABLE_BOT !== '1') {
    console.log('[bot] iniciando agente WhatsApp (número ' + config.NUMERO_AGENTE + ')...');
    bot.iniciar();
  }
});
