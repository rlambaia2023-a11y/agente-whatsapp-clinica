// Cliente da API pública da Clínica Única.
// Rotas usadas: /api/clinica, /api/disponibilidade, /api/agendar,
// /api/meus-agendamentos. Nada aqui exige login de profissional.
const config = require('./config');

const BASE = config.CLINICA_API_URL;
let cacheClinica = null;
let cacheClinicaEm = 0;

async function getJson(url, opcoes) {
  const r = await fetch(url, opcoes);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Clínica Única devolveu HTTP ${r.status}`);
  return j;
}

async function getClinica() {
  const agora = Date.now();
  if (cacheClinica && agora - cacheClinicaEm < 10 * 60 * 1000) return cacheClinica;
  const j = await getJson(`${BASE}/api/clinica`);
  cacheClinica = j;
  cacheClinicaEm = agora;
  return j;
}

async function disponibilidade(data, localId) {
  const u = new URL(`${BASE}/api/disponibilidade`);
  u.searchParams.set('profissional', config.PROFISSIONAL_ID);
  u.searchParams.set('data', data);
  u.searchParams.set('local', localId);
  return getJson(u.toString());
}

async function agendar({ nome, telefone, data, hora, tipoConsulta, localId, motivo }) {
  return getJson(`${BASE}/api/agendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome, telefone,
      profissionalId: config.PROFISSIONAL_ID,
      data, hora, tipoConsulta: tipoConsulta || '', localId,
      motivo: motivo || '', canal: 'whatsapp',
    }),
  });
}

async function meusAgendamentos(telefone) {
  const u = new URL(`${BASE}/api/meus-agendamentos`);
  u.searchParams.set('telefone', telefone.replace(/\D/g, ''));
  return getJson(u.toString());
}

module.exports = { getClinica, disponibilidade, agendar, meusAgendamentos };
