// Servidor do agente de WhatsApp da clínica.
// GET /health — versão e estado, sem expor dados de paciente.
// GET /status — estado da conexão WhatsApp e da IA.
// GET /qr.png — QR de pareamento, quando disponível (sem cache).
// POST /api/reconectar — reinicia a conexão (gera novo QR).
// POST /api/limpar-sessao — apaga a sessão salva e força novo pareamento.
// POST /api/pareamento — { numero } devolve o código de 8 caracteres.
// POST /api/avisar — { texto } aviso do PEPMH para o WhatsApp da MH (exige Authorization: Bearer AVISOS_TOKEN).
const http = require('http');
const fs = require('fs');
const config = require('./config');
const agente = require('./agente');
const gemini = require('./gemini');
const bot = require('./bot');
const avisos = require('./avisos');
const crypto = require('crypto');
const tokenOk = (req) => { const t = config.AVISOS_TOKEN, h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); return t.length >= 24 && h.length === t.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(t)); };

const VERSAO = '1.1.0';

function enviar(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
    return enviar(res, 200, { ok: true, whatsapp: agente.status(), ia: gemini.status(), facebookUrlConfigurada: Boolean(config.FACEBOOK_URL), avisosNaFila: avisos.pendentes() });
  }
  if (req.method === 'GET' && url.pathname === '/qr.png') {
    const st = agente.status();
    if (!st.qrDisponivel || !fs.existsSync(agente.QR_PATH)) {
      return enviar(res, 404, { ok: false, erro: 'Sem QR no momento. Se já estiver conectado, não é preciso parear.', whatsapp: st });
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    return fs.createReadStream(agente.QR_PATH).pipe(res);
  }
  if (req.method === 'POST' && url.pathname === '/api/reconectar') {
    return enviar(res, 200, { ok: agente.reconnect(), mensagem: 'Reconectando — aguarde alguns segundos e atualize o QR.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/limpar-sessao') {
    return enviar(res, 200, { ok: agente.resetSession(), mensagem: 'Sessão apagada. Um novo QR será gerado em instantes — escaneie com o celular do número do agente.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/pareamento') {
    const b = await lerCorpo(req);
    try {
      const codigo = await agente.requestPairingCode(b.numero || config.NUMERO_AGENTE);
      return enviar(res, 200, { ok: true, codigo, dica: 'No WhatsApp: Aparelhos conectados > Conectar aparelho > Conectar com número de telefone.' });
    } catch (e) {
      return enviar(res, 400, { ok: false, erro: e.message, whatsapp: agente.status() });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/avisar') {
    if (!tokenOk(req)) return enviar(res, 401, { ok: false, erro: 'Não autorizado.' });
    const b = await lerCorpo(req);
    try { return enviar(res, 200, { ok: true, ...(await avisos.avisar(b.texto)) }); }
    catch (e) { return enviar(res, 400, { ok: false, erro: e.message }); }
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
