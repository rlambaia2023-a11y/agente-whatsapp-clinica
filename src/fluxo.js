// Máquina de conversa do agente: menu, agendamento, minhas consultas,
// informações e encaminhamento para atendente. Sem Baileys aqui, para o
// fluxo poder ser testado sem WhatsApp. Regras primeiro; Gemini só quando
// as regras não classificam a mensagem.
const gemini = require('./gemini');
const config = require('./config');

const LOCAIS = [
  { id: 'maraclin', nome: 'Maraclin', rotulos: ['maraclin', 'maragogipe'] },
  { id: 'santa-casa-sao-felix', nome: 'Santa Casa de São Félix', rotulos: ['santa casa', 'sao felix', 'são félix'] },
  { id: 'online', nome: 'Online', rotulos: ['online', 'teleconsulta', 'video', 'vídeo'] },
  { id: 'muritiba', nome: 'MH Cuidar em Muritiba', rotulos: ['muritiba', 'mh cuidar', 'mhcuidar', 'paulo souto'] },
];
const TIPOS = ['Consulta ginecológica', 'Pré-natal', 'Clínica geral'];

function agoraSP() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}
function fmtData(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function fmtDataCurta(iso) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dt = new Date(`${iso}T12:00:00`);
  return `${dias[dt.getDay()]} ${fmtData(iso)}`;
}
function isoDe(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function hojeSP(offset = 0) {
  const d = agoraSP();
  d.setDate(d.getDate() + offset);
  return isoDe(d);
}

// Entende "hoje", "amanhã", dia da semana, "12/11" e "12/11/2026".
function parseData(texto, ref = agoraSP()) {
  const t = (texto || '').toLowerCase();
  if (/\bhoje\b/.test(t)) return hojeSP(0);
  if (/amanh/.test(t)) return hojeSP(1);
  const m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    let ano = m[3] ? Number(m[3]) : ref.getFullYear();
    if (ano < 100) ano += 2000;
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (!m[3] && iso < hojeSP(0)) return `${ano + 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      return iso;
    }
  }
  const dias = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'];
  const idx = dias.findIndex((d) => t.includes(d));
  if (idx >= 0) {
    const alvo = idx === 3 ? 2 : idx; // "terca" sem acento cai no mesmo dia
    let dif = (alvo - ref.getDay() + 7) % 7;
    if (dif === 0) dif = 7;
    const d = new Date(ref);
    d.setDate(d.getDate() + dif);
    return isoDe(d);
  }
  return null;
}

function normalizar(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function classificarRegras(texto) {
  const t = normalizar(texto);
  if (/^(oi|ola|bom dia|boa tarde|boa noite|menu|ajuda|inicio|oi!)\b/.test(t) || t === 'oi') return { intencao: 'saudacao' };
  if (/\b(atendente|humano|falar com alguem|alguem|pessoa)\b/.test(t)) return { intencao: 'atendente' };
  if (/\b(minhas consultas|meu agendamento|meus agendamentos|ver minha consulta|consultas marcadas)\b/.test(t)) return { intencao: 'minhas_consultas' };
  if (/\b(remarcar|mudar.*(data|hora|dia)|trocar.*(data|hora|dia))\b/.test(t)) return { intencao: 'remarcar' };
  if (/\b(cancelar|desmarcar)\b/.test(t)) return { intencao: 'remarcar' };
  if (/\b(muritiba|mh cuidar|paulo souto|emagrecimento)\b/.test(t)) return { intencao: 'mh_cuidar' };
  if (/\b(valor|preco|quanto custa|quanto e|pagamento|plano|convenio)\b/.test(t)) return { intencao: 'valores' };
  if (/\b(endereco|onde fica|localizacao|como chegar)\b/.test(t)) return { intencao: 'endereco' };
  if (/\b(horario|hora.*(atende|funciona)|quando abre|dias.*atende)\b/.test(t)) return { intencao: 'horarios' };
  if (/\b(agendar|marcar|consulta|agendamento|quero.*consulta)\b/.test(t)) return { intencao: 'agendar' };
  if (/\b(sintoma|dor|corrimento|exame|resultado|remedio|medicamento|diagnostico|estou (gravida|grávida)|sangramento)\b/.test(t)) return { intencao: 'duvida_clinica' };
  return null;
}

const MENU = `Olá! Aqui é o atendimento da MH Cuidar / Dra. Mayara Miranda. 🌸

O que você precisa?
1️⃣ Agendar consulta (Maraclin, Santa Casa ou online)
2️⃣ MH Cuidar em Muritiba
3️⃣ Ver minhas consultas
4️⃣ Horários e endereços
5️⃣ Falar com uma atendente

É só responder com o número ou escrever o que precisa.`;

function textoInfo(info) {
  const locais = (info?.clinica?.locais || []).filter((l) => l.reservavel);
  const linhas = ['📍 *Horários e endereços — Dra. Mayara Miranda*', ''];
  for (const l of locais) {
    linhas.push(`• *${l.nome}* — ${l.endereco}, ${l.cidade}`);
    if (l.horario) linhas.push(`  ${l.horario}`);
  }
  linhas.push(`• *Online* — todos os dias, 08h às 17h (Google Meet)`);
  linhas.push('', `• *MH Cuidar em Muritiba* — ${config.MH_CUIDAR_ENDERECO}, ${config.MH_CUIDAR_TELEFONE}`);
  linhas.push('  Acesse o sistema para criar sua conta e agendar: ' + config.MH_CUIDAR_LINK);
  if (config.FACEBOOK_URL) linhas.push('', 'Também estamos no Facebook: ' + config.FACEBOOK_URL);
  linhas.push('', 'Consultas particulares, 60 minutos. Para agendar, responda *1*.');
  return linhas.join('\n');
}

function textoMhCuidar() {
  return [
    '💚 *MH Cuidar em Muritiba*',
    '',
    `${config.MH_CUIDAR_ENDERECO}`,
    `Telefone: ${config.MH_CUIDAR_TELEFONE}`,
    '',
    'Para agendar no MH Cuidar, acesse o sistema:',
    config.MH_CUIDAR_LINK,
    '',
    'Crie sua conta e agende sua consulta por lá.',
    'Os horários aparecem na página. Se preferir a Gineco na Maraclin, na Santa Casa ou online, responda *1* que eu agendo aqui mesmo.',
  ].join('\n');
}

function novaSessao() {
  return { etapa: 'idle', dados: {} };
}

async function processar(sessao, textoRaw, deps) {
  const texto = (textoRaw || '').trim();
  const t = normalizar(texto);
  const respostas = [];
  const responder = (s) => respostas.push(s);

  if (/^(menu|ajuda|inicio|voltar)$/.test(t)) {
    sessao.etapa = 'idle';
    sessao.dados = {};
    responder(MENU);
    return respostas;
  }
  if (/^0$/.test(t) || /\bcancelar\b/.test(t) && sessao.etapa !== 'idle') {
    sessao.etapa = 'idle';
    sessao.dados = {};
    responder('Tudo bem, cancelei este passo. ' + MENU);
    return respostas;
  }

  // Etapas do agendamento, antes de classificar a mensagem solta.
  if (sessao.etapa === 'aguardando_local') {
    const local = LOCAIS.find((l) => l.rotulos.some((r) => t.includes(r)) || t === String(LOCAIS.indexOf(l) + 1));
    if (!local || local.id === 'muritiba') {
      if (local?.id === 'muritiba') { sessao.etapa = 'idle'; sessao.dados = {}; responder(textoMhCuidar()); return respostas; }
      responder('Não entendi o local. Responda *1* para Maraclin, *2* para Santa Casa de São Félix ou *3* para online.');
      return respostas;
    }
    sessao.dados.localId = local.id;
    sessao.dados.localNome = local.nome;
    sessao.etapa = 'aguardando_data';
    responder(`Perfeito, ${local.nome}. Para qual dia? Pode ser *hoje*, *amanhã*, um dia da semana ou uma data, como 14/11.`);
    return respostas;
  }
  if (sessao.etapa === 'aguardando_data') {
    const data = parseData(texto);
    if (!data) { responder('Não entendi o dia. Tente *hoje*, *amanhã* ou uma data como 14/11.'); return respostas; }
    if (data < hojeSP(0)) { responder('Essa data já passou. Me diga outro dia, por favor.'); return respostas; }
    sessao.dados.data = data;
    try {
      const disp = await deps.clinica.disponibilidade(data, sessao.dados.localId);
      const livres = (disp.slots || []).filter((s) => s.livre);
      if (!livres.length) {
        sessao.etapa = 'aguardando_data';
        responder(disp.motivo || `Não há horário livre em ${sessao.dados.localNome} no dia ${fmtDataCurta(data)}. Quer tentar outro dia?`);
        return respostas;
      }
      sessao.dados.slots = livres.map((s) => s.hora);
      sessao.etapa = 'aguardando_hora';
      responder(`Horários livres em ${sessao.dados.localNome} no dia ${fmtDataCurta(data)}:\n${livres.map((s) => `• ${s.hora}`).join('\n')}\n\nQual horário você prefere?`);
      return respostas;
    } catch (e) {
      sessao.etapa = 'idle';
      responder('Não consegui consultar a agenda agora. Tente de novo em instantes ou fale com uma atendente respondendo *5*.');
      return respostas;
    }
  }
  if (sessao.etapa === 'aguardando_hora') {
    const m = texto.match(/(\d{1,2})[:hH]?(\d{2})?/);
    const hora = m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2] || '00'}` : null;
    if (!hora || !(sessao.dados.slots || []).includes(hora)) {
      responder(`Esse horário não está na lista. Escolha um destes: ${(sessao.dados.slots || []).join(', ')}.`);
      return respostas;
    }
    sessao.dados.hora = hora;
    sessao.etapa = 'aguardando_tipo';
    responder('Qual o tipo de consulta?\n1️⃣ Consulta ginecológica\n2️⃣ Pré-natal\n3️⃣ Clínica geral');
    return respostas;
  }
  if (sessao.etapa === 'aguardando_tipo') {
    const idx = ['1', '2', '3'].indexOf(t.trim());
    const porTexto = TIPOS.find((x) => t.includes(normalizar(x).split(' ')[0])) || (t.includes('pre-natal') || t.includes('prenatal') ? 'Pré-natal' : null);
    const tipo = idx >= 0 ? TIPOS[idx] : porTexto;
    if (!tipo) { responder('Escolha *1* para ginecológica, *2* para pré-natal ou *3* para clínica geral.'); return respostas; }
    sessao.dados.tipoConsulta = tipo;
    sessao.etapa = 'aguardando_nome';
    responder('Qual o seu nome completo?');
    return respostas;
  }
  if (sessao.etapa === 'aguardando_nome') {
    if (texto.length < 3) { responder('Me diga seu nome completo, por favor.'); return respostas; }
    sessao.dados.nome = texto;
    sessao.etapa = 'aguardando_confirmacao';
    const d = sessao.dados;
    responder([
      '📋 *Confira sua consulta:*',
      '',
      `👩‍⚕️ Dra. Mayara Miranda — ${d.tipoConsulta}`,
      `📍 ${d.localNome}`,
      `📅 ${fmtDataCurta(d.data)} às ${d.hora}`,
      `👤 ${d.nome}`,
      '',
      'Está certo? Responda *SIM* para confirmar ou *NÃO* para recomeçar.',
    ].join('\n'));
    return respostas;
  }
  if (sessao.etapa === 'aguardando_confirmacao') {
    if (/^(sim|s|confirmo|confirmar|certo|ok)\b/.test(t)) {
      try {
        const r = await deps.clinica.agendar({
          nome: sessao.dados.nome, telefone: deps.telefone,
          data: sessao.dados.data, hora: sessao.dados.hora,
          tipoConsulta: sessao.dados.tipoConsulta, localId: sessao.dados.localId,
        });
        const ag = r.agendamento || {};
        sessao.etapa = 'idle';
        sessao.dados = {};
        responder([
          '✅ *Consulta agendada!*',
          '',
          `👩‍⚕️ Dra. Mayara Miranda — ${ag.tipoConsulta || ''}`,
          `📍 ${ag.localId === 'online' ? 'Online (Google Meet)' : ag.localId}`,
          `📅 ${fmtDataCurta(ag.data || '')} às ${ag.hora || ''}`,
          ag.codigo ? `🔖 Código: ${ag.codigo}` : null,
          '',
          'Qualquer mudança, fale aqui que eu encaminho para a clínica. Até lá! 🌸',
        ].filter(Boolean).join('\n'));
        return respostas;
      } catch (e) {
        sessao.etapa = 'idle';
        sessao.dados = {};
        responder(`Não consegui concluir o agendamento: ${e.message} Tente de novo ou fale com uma atendente respondendo *5*.`);
        return respostas;
      }
    }
    sessao.etapa = 'idle';
    sessao.dados = {};
    responder('Tudo bem, não agendei. ' + MENU);
    return respostas;
  }
  if (sessao.etapa === 'aguardando_remarcacao') {
    await deps.registrarAtendimento({ tipo: 'remarcacao', telefone: deps.telefone, detalhe: texto });
    sessao.etapa = 'idle';
    sessao.dados = {};
    responder('Anotei seu pedido de remarcação e encaminhei para a clínica. A equipe confirma o novo horário aqui mesmo no WhatsApp. Obrigada! 💚');
    return respostas;
  }

  // Fora de um fluxo: classifica a intenção.
  let cls = classificarRegras(texto);
  if (!cls && /^[1-5]$/.test(t)) {
    cls = { intencao: ['agendar', 'mh_cuidar', 'minhas_consultas', 'horarios', 'atendente'][Number(t) - 1] };
  }
  if (!cls) {
    const g = await gemini.classificar(texto).catch(() => null);
    if (g?.intencao) cls = g;
  }
  if (!cls) {
    responder('Não entendi bem. ' + MENU);
    return respostas;
  }

  switch (cls.intencao) {
    case 'saudacao':
      responder(MENU);
      break;
    case 'agendar': {
      const local = cls.local ? LOCAIS.find((l) => l.id === cls.local) : null;
      if (local && local.id !== 'muritiba') {
        sessao.dados.localId = local.id;
        sessao.dados.localNome = local.nome;
        sessao.etapa = 'aguardando_data';
        if (cls.data) sessao.dados.data = cls.data;
        responder(`Vamos agendar na ${local.nome}. Para qual dia? Pode ser *hoje*, *amanhã*, um dia da semana ou uma data, como 14/11.`);
      } else if (local?.id === 'muritiba') {
        responder(textoMhCuidar());
      } else {
        sessao.etapa = 'aguardando_local';
        responder('Vamos agendar! Onde você prefere?\n1️⃣ Maraclin (Maragogipe)\n2️⃣ Santa Casa de São Félix\n3️⃣ Online\n4️⃣ MH Cuidar em Muritiba');
      }
      break;
    }
    case 'mh_cuidar':
      responder(textoMhCuidar());
      break;
    case 'minhas_consultas': {
      try {
        const r = await deps.clinica.meusAgendamentos(deps.telefone);
        const lista = (r.agendamentos || []).filter((a) => a.status !== 'cancelado');
        if (!lista.length) {
          responder(`Não encontrei consultas marcadas com este número.\n\nPara agendar (inclusive no MH Cuidar), acesse o sistema: ${config.MH_CUIDAR_LINK}\nCrie sua conta e agende sua consulta por lá.\n\nOu responda *1* para agendar na Maraclin, Santa Casa ou online.`);
        } else {
          const linhas = ['📅 *Suas consultas:*', ''];
          for (const a of lista.slice(0, 5)) {
            linhas.push(`• ${fmtDataCurta(a.data)} às ${a.hora} — ${a.tipoConsulta || 'Consulta'} (${a.localId === 'online' ? 'online' : a.localId}) — ${a.status}`);
          }
          linhas.push('', 'Para remarcar alguma, responda *remarcar* e me diga qual e o novo dia.');
          linhas.push('', `Consultas MH Cuidar: acesse ${config.MH_CUIDAR_LINK}, crie sua conta e agende por lá.`);
          responder(linhas.join('\n'));
        }
      } catch {
        responder('Não consegui consultar suas consultas agora. Tente de novo em instantes.');
      }
      break;
    }
    case 'horarios':
    case 'endereco': {
      try {
        const info = await deps.clinica.getClinica();
        responder(textoInfo(info));
      } catch {
        responder(textoInfo(null));
      }
      break;
    }
    case 'valores':
      responder('As consultas são particulares e o valor é informado pela clínica, porque pode variar por tipo de consulta. Quer que eu encaminhe sua pergunta para uma atendente? Responda *5* que eu encaminho.');
      break;
    case 'remarcar':
      sessao.etapa = 'aguardando_remarcacao';
      responder('Claro. Me diga qual consulta você quer remarcar e para qual dia e horário você prefere. Anoto aqui e a clínica confirma.');
      break;
    case 'duvida_clinica':
      responder('Por aqui eu não consigo avaliar sintomas, exames ou remédios, para a sua segurança. O ideal é uma consulta com a Dra. Mayara. Quer agendar? Responda *1*. Se for algo urgente, procure atendimento presencial.');
      break;
    case 'atendente':
      await deps.registrarAtendimento({ tipo: 'atendente', telefone: deps.telefone, detalhe: texto });
      responder('Encaminhei para uma atendente da clínica. Ela responde aqui mesmo neste número. Se preferir, pode ligar para ' + config.MH_CUIDAR_TELEFONE + '.');
      break;
    default:
      responder(MENU);
  }
  return respostas;
}

module.exports = { novaSessao, processar, parseData, hojeSP, classificarRegras, MENU, LOCAIS };
