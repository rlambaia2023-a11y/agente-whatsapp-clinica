// Configuração do agente de WhatsApp da clínica.
// Nada sensível fica fixo aqui: chaves e URLs vão por variável de ambiente.
require('dotenv').config();
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  DATA_DIR,
  PORT: Number(process.env.PORT || 3108),
  // API da Clínica Única (agendamento Gineco: Maraclin, Santa Casa, online).
  CLINICA_API_URL: (process.env.CLINICA_API_URL || 'https://clinica-unica-production.up.railway.app').replace(/\/$/, ''),
  PROFISSIONAL_ID: process.env.PROFISSIONAL_ID || 'mayara',
  // Número do WhatsApp da clínica, o que o agente usa para atender.
  // É o número que precisa estar logado no WhatsApp do celular na hora do pareamento.
  NUMERO_AGENTE: (process.env.NUMERO_AGENTE || '5575981089146').replace(/\D/g, ''),
  // Agendamento MH Cuidar em Muritiba (PEPMH): não tem API pública para
  // reservar direto, por isso o agente manda o link oficial.
  MH_CUIDAR_LINK: process.env.MH_CUIDAR_LINK || 'https://pepmh-web-production.up.railway.app/#/',
  MH_CUIDAR_ENDERECO: 'Avenida Paulo Souto, 34, Muritiba/BA',
  MH_CUIDAR_TELEFONE: '(75) 99181-5612',
  // Página no Facebook: Mh.cuidar, perfil profissional.
  // Link enviado pelo usuário em 11/11/2026.
  FACEBOOK_URL: process.env.FACEBOOK_URL || 'https://www.facebook.com/people/Mhcuidar/61596125085494/',
  // IA: só Gemini Lite, com cache e parada em 429. Sem chave, o agente
  // funciona só com regras e menu, sem inventar resposta.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
};
