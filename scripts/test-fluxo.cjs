// Teste local do fluxo, sem WhatsApp e sem Gemini.
// Roda: npm test
const assert = require('node:assert');
const fluxo = require('../src/fluxo');

const chamadas = { agendar: [] };
const fila = [];
const clinicaMock = {
  async getClinica() {
    return { clinica: { locais: [
      { id: 'maraclin', nome: 'Clínica Maraclin', endereco: 'R. Dr. Maurício Rebouças, 118', cidade: 'Maragogipe, BA', horario: 'Segunda a sexta, 06:00 às 16:00', reservavel: true },
      { id: 'santa-casa-sao-felix', nome: 'Santa Casa de Misericórdia São Félix', endereco: 'Rua Nova, 1', cidade: 'São Félix, BA', horario: 'Segunda a sexta, 08:00 às 17:00', reservavel: true },
    ] } };
  },
  async disponibilidade(data, localId) {
    return { ok: true, slots: ['08:00', '09:00', '10:00'].map((hora) => ({ hora, livre: true })) };
  },
  async agendar(dados) {
    chamadas.agendar.push(dados);
    return { ok: true, agendamento: { ...dados, codigo: 'TESTE123', status: 'aguardando' } };
  },
  async meusAgendamentos() {
    return { ok: true, agendamentos: [{ data: '2026-11-12', hora: '09:00', tipoConsulta: 'Consulta ginecológica', localId: 'maraclin', status: 'aguardando' }] };
  },
};
const deps = { telefone: '5575999999999', clinica: clinicaMock, registrarAtendimento: async (i) => { fila.push(i); } };

async function conversa(mensagens) {
  const sessao = fluxo.novaSessao();
  const todas = [];
  for (const m of mensagens) {
    const r = await fluxo.processar(sessao, m, deps);
    todas.push(...r);
  }
  return todas;
}

(async () => {
  // Datas em pt-BR.
  assert.strictEqual(fluxo.parseData('amanhã'), '2026-11-12');
  assert.strictEqual(fluxo.parseData('14/11'), '2026-11-14');
  assert.strictEqual(fluxo.parseData('hoje'), '2026-11-11');

  // Fluxo completo de agendamento.
  let r = await conversa(['oi', '1', '1', 'amanhã', '09:00', '1', 'Maria da Silva', 'sim']);
  assert.ok(r.some((x) => x.includes('Consulta agendada')), 'deveria confirmar o agendamento');
  assert.ok(r.some((x) => x.includes('TESTE123')), 'deveria mostrar o código');
  assert.strictEqual(chamadas.agendar.length, 1);
  assert.strictEqual(chamadas.agendar[0].nome, 'Maria da Silva');
  assert.strictEqual(chamadas.agendar[0].telefone, '5575999999999');
  assert.strictEqual(chamadas.agendar[0].localId, 'maraclin');
  assert.strictEqual(chamadas.agendar[0].data, '2026-11-12');

  // MH Cuidar em Muritiba: manda o link, não agenda direto.
  r = await conversa(['2']);
  assert.ok(r.some((x) => x.includes('pepmh-web-production.up.railway.app')), 'deveria mandar o link do MH Cuidar');
  assert.ok(r.some((x) => x.includes('Paulo Souto')), 'deveria mostrar o endereço de Muritiba');

  // Minhas consultas.
  r = await conversa(['3']);
  assert.ok(r.some((x) => x.includes('Suas consultas')), 'deveria listar consultas');

  // Horários e endereços, sem inventar preço.
  r = await conversa(['4']);
  assert.ok(r.some((x) => x.includes('Maraclin')), 'deveria listar locais');

  // Valores: não inventa preço.
  r = await conversa(['quanto custa a consulta?']);
  assert.ok(r.some((x) => x.includes('particular')), 'deveria dizer que é particular sem inventar valor');
  assert.ok(!r.some((x) => /R\$ ?\d/.test(x)), 'não pode inventar preço');

  // Dúvida clínica: não diagnostica.
  r = await conversa(['estou com dor e corrimento, o que pode ser?']);
  assert.ok(r.some((x) => x.includes('não consigo avaliar sintomas')), 'não pode dar diagnóstico');

  // Remarcar vai para a fila da atendente, sem cancelar nada.
  r = await conversa(['quero remarcar minha consulta para sexta']);
  assert.ok(r.some((x) => x.includes('qual consulta')), 'deveria pedir detalhe da remarcação');
  r = await conversa(['remarcar', 'a de amanhã 9h para sexta 10h']);
  assert.strictEqual(fila.filter((f) => f.tipo === 'remarcacao').length, 1, 'remarcação deve ir para a fila');

  // Atendente.
  r = await conversa(['falar com atendente']);
  assert.strictEqual(fila.filter((f) => f.tipo === 'atendente').length, 1, 'atendente deve ir para a fila');

  console.log('OK — todos os testes do fluxo passaram.');
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
