(() => {
'use strict';

// Escolhe a camada de dados: Supabase (js/config.js preenchido) ou demo local.
const useFirebase = !!(window.CV_CONFIG && window.CV_CONFIG.firebase && window.CV_CONFIG.firebase.apiKey);
const Store = useFirebase ? window.FirebaseStore : window.LocalStore;
if (!Store) {
  document.getElementById('app').innerHTML = '<div class="alert">Não foi possível carregar o Firebase. Verifique a conexão e recarregue a página.</div>';
  return;
}

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const dtt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const CATS = [
  ['alimentacao', 'alimentação'],
  ['abastecimento', 'abastecimento'],
  ['hospedagem', 'hospedagem'],
  ['outros', 'outros'],
];
const catName = (k) => (CATS.find((c) => c[0] === k) || [k, k])[1];
const STATUS = {
  em_viagem: 'em andamento',
  enviada: 'enviada ao financeiro',
  correcao: 'correção pedida',
  conferida: 'aguardando acerto',
  encerrada: 'encerrada',
};

/* ---------- estado ---------- */
let trips = [];
let userId = null;
let authMsg = '';
const me = () => Store.USERS.find((u) => u.id === userId);
const isFin = () => me().papel === 'financeiro';
const userName = (id) => (Store.USERS.find((u) => u.id === id) || { nome: id }).nome;
const visible = () => (isFin() ? trips : trips.filter((t) => t.tecnicoId === userId));
const byNew = (a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || '');

async function load() { trips = await Store.list(); }

function totals(t) {
  const adiant = {}; const gasto = {};
  CATS.forEach(([k]) => { adiant[k] = r2(t.adiantamento?.[k]); gasto[k] = 0; });
  t.despesas.forEach((d) => { gasto[d.categoria] = r2((gasto[d.categoria] || 0) + Number(d.valor)); });
  const A = r2(Object.values(adiant).reduce((s, v) => s + v, 0));
  const G = r2(Object.values(gasto).reduce((s, v) => s + v, 0));
  return { adiant, gasto, A, G, saldo: r2(A - G) };
}
const saldoTxt = (s) => (s > 0 ? 'técnico devolve' : s < 0 ? 'empresa reembolsa' : 'contas zeradas');

function log(t, texto) { t.historico.push({ em: new Date().toISOString(), por: me().nome, texto }); }

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3800);
}

/* ---------- chrome (topo + nav) ---------- */
function chrome(route) {
  const sel = $('#who');
  $('.who').hidden = !userId;
  $('.foot').textContent = Store.demo
    ? 'Protótipo: os dados ficam salvos apenas neste navegador.'
    : 'Dados salvos com segurança na nuvem (Firebase).';
  if (!userId) { $('#nav').innerHTML = ''; return; }
  $('.who-demo').hidden = !Store.demo; $('#whoami').hidden = Store.demo; $('#logout').hidden = Store.demo;
  if (!Store.demo) $('#whoami').textContent = `${me().nome} · ${me().papel === 'financeiro' ? 'financeiro' : 'técnico'}`;
  sel.innerHTML = Store.USERS.map((u) => `<option value="${u.id}" ${u.id === userId ? 'selected' : ''}>${esc(u.nome)} — ${u.papel === 'financeiro' ? 'financeiro' : 'técnico'}</option>`).join('');
  const fila = trips.filter((t) => ['enviada', 'conferida'].includes(t.status)).length;
  const items = [['#/', 'Painel'], ['#/nova', 'Nova viagem']];
  if (isFin()) items.push(['#/fila', 'Fila' + (fila ? `<span class="badge">${fila}</span>` : '')]);
  items.push(['#/relatorio', 'Relatório']);
  $('#nav').innerHTML = items.map(([h, l]) => `<a href="${h}" class="${route === h ? 'on' : ''}"${route === h ? ' aria-current="page"' : ''}>${l}</a>`).join('');
}

/* ---------- views ---------- */
function tripCard(t) {
  const x = totals(t);
    return `<a class="card" href="#/viagem/${t.id}">
    <span class="tag s-${t.status}">${STATUS[t.status]}</span>
    <h3>${esc(t.cidades.join(' · '))}</h3>
    <div class="who2">${esc(userName(t.tecnicoId))}</div>
    <div class="meta">${dt(t.ida)}${t.volta && t.volta !== t.ida ? ' → ' + dt(t.volta) : ''}</div>
    <div class="val"><span>gasto ${brl(x.G)}</span><span class="${x.saldo < 0 ? 'blue' : ''}">${x.A || x.G ? esc(saldoTxt(x.saldo)) : '—'}</span></div>
  </a>`;
}

function vPainel() {
  const list = visible().slice().sort(byNew);
  const andamento = list.filter((t) => ['em_viagem', 'correcao'].includes(t.status)).length;
  const conferir = list.filter((t) => ['enviada', 'conferida'].includes(t.status)).length;
  const gasto = list.reduce((s, t) => s + totals(t).G, 0);
  return `<div class="view">
    <div class="head">
      <h1>${isFin() ? 'Todas as viagens' : 'Minhas viagens'}</h1>
      <p>${isFin() ? 'Confira o que a equipe lançou, aprove e registre o acerto.' : 'Registre cada gasto com a nota, assine e envie ao financeiro.'}</p></div>
    <div class="panel summary"><div class="grid">
      <div class="stat"><div class="l">viagens</div><div class="n">${list.length}</div></div>
      <div class="stat"><div class="l">em andamento</div><div class="n">${andamento}</div></div>
      <div class="stat"><div class="l">${isFin() ? 'para conferir / acertar' : 'com o financeiro'}</div><div class="n">${conferir}</div></div>
      <div class="stat"><div class="l">total gasto</div><div class="n">${brl(gasto)}</div></div>
    </div></div>
    ${list.length ? `<div class="cards">${list.map(tripCard).join('')}</div>` : `
      <div class="empty"><p>Nenhuma viagem cadastrada.</p>
        <div class="row" style="justify-content:center"><a class="btn primary" href="#/nova">Nova viagem</a>
        ${Store.demo ? '<button data-act="demo">Carregar exemplo</button>' : ''}</div></div>`}
  </div>`;
}

function advFields(v = {}) {
  return `<div class="grid">${CATS.map(([k, n]) => `<div class="fld"><label class="f" for="adv-${k}">${n}</label>
    <input id="adv-${k}" name="adv_${k}" type="number" inputmode="decimal" min="0" step="0.01" value="${v[k] ? esc(v[k]) : ''}" placeholder="0,00"></div>`).join('')}</div>`;
}

function vNova() {
  return `<div class="view">
    <div class="head"><h1>Nova viagem</h1>
      <p>Informe quem vai, para onde e se o financeiro passou algum dinheiro.</p></div>
    <form class="panel" data-form="nova" autocomplete="off">
      <div class="grid">
        <div class="fld"><label class="f" for="tec">técnico</label>
          ${isFin() ? `<select id="tec" name="tecnico">${Store.USERS.filter((u) => u.papel === 'tecnico').map((u) => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select>`
            : `<input id="tec" value="${esc(me().nome)}" disabled>`}</div>
        <div class="fld"><label class="f" for="c1">cidade</label><input id="c1" name="c1" required placeholder="para onde vai"></div>
        <div class="fld"><label class="f" for="c2">segunda cidade (se houver)</label><input id="c2" name="c2" placeholder="opcional"></div>
      </div>
      <div class="grid">
        <div class="fld"><label class="f" for="ida">ida</label><input id="ida" name="ida" type="date" required value="${today()}"></div>
        <div class="fld"><label class="f" for="volta">volta</label><input id="volta" name="volta" type="date" required value="${today()}"></div>
      </div>
      <div class="fld"><label class="f" for="fin">finalidade</label><input id="fin" name="finalidade" placeholder="ex.: manutenção de equipamento (opcional)"></div>
      <hr class="rule">
      <div class="fld"><span class="f" style="display:block;margin-bottom:6px">o financeiro passou dinheiro?</span>
        <div class="seg"><label><input type="radio" name="adv" value="nao" checked><span>Não</span></label>
        <label><input type="radio" name="adv" value="sim"><span>Sim</span></label></div>
        <div class="hint">Sem adiantamento: você paga do bolso e pede reembolso depois.</div></div>
      <div id="advbox" hidden>${advFields()}<div class="hint">Separe por finalidade: abastecimento, hospedagem, alimentação.</div></div>
      <div class="row" style="margin-top:18px"><button class="primary" type="submit">Criar viagem</button><a class="btn" href="#/">Cancelar</a></div>
    </form></div>`;
}

function vFila() {
  if (!isFin()) return vPainel();
  const a = trips.filter((t) => t.status === 'enviada').sort(byNew);
  const b = trips.filter((t) => t.status === 'conferida').sort(byNew);
  return `<div class="view">
    <div class="head"><h1>Fila do financeiro</h1>
      <p>O que está esperando conferência ou acerto de reembolso/devolução.</p></div>
    <h3 style="margin-bottom:16px">Para conferir (${a.length})</h3>
    ${a.length ? `<div class="cards">${a.map(tripCard).join('')}</div>` : '<div class="empty"><p>Nada para conferir.</p></div>'}
    <h3 style="margin-bottom:16px">Aguardando acerto (${b.length})</h3>
    ${b.length ? `<div class="cards">${b.map(tripCard).join('')}</div>` : '<div class="empty"><p>Nenhum acerto pendente.</p></div>'}
  </div>`;
}

function vRelatorio() {
  const list = visible().slice().sort(byNew);
  const pend = list.filter((t) => ['enviada', 'conferida', 'em_viagem', 'correcao'].includes(t.status));
  const reemb = r2(pend.reduce((s, t) => s + Math.max(0, -totals(t).saldo), 0));
  const devol = r2(pend.reduce((s, t) => s + Math.max(0, totals(t).saldo), 0));
  const gCat = {}; CATS.forEach(([k]) => { gCat[k] = 0; });
  list.forEach((t) => { const x = totals(t); CATS.forEach(([k]) => { gCat[k] = r2(gCat[k] + x.gasto[k]); }); });
  return `<div class="view">
    <div class="head"><h1>Relatório de despesas</h1>
      <p>${isFin() ? 'Visão geral da equipe.' : 'Suas viagens e gastos.'}</p></div>
    <div class="panel summary"><div class="grid">
      <div class="stat"><div class="l">gasto total</div><div class="n">${brl(list.reduce((s, t) => s + totals(t).G, 0))}</div></div>
      <div class="stat"><div class="l">a reembolsar (em aberto)</div><div class="n">${brl(reemb)}</div></div>
      <div class="stat"><div class="l">a devolver (em aberto)</div><div class="n">${brl(devol)}</div></div>
    </div></div>
    <div class="panel"><h3>Por categoria</h3><div class="tw"><table>
      <thead><tr><th>categoria</th><th class="r">gasto</th></tr></thead>
      <tbody>${CATS.map(([k, n]) => `<tr><td>${n}</td><td class="r">${brl(gCat[k])}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h3>Viagens</h3>${list.length ? `<div class="tw"><table>
      <thead><tr><th>data</th><th>técnico</th><th>cidades</th><th>status</th><th class="r">adiantado</th><th class="r">gasto</th><th class="r">saldo</th></tr></thead>
      <tbody>${list.map((t) => { const x = totals(t); return `<tr><td>${dt(t.ida)}</td><td>${esc(userName(t.tecnicoId))}</td><td><a href="#/viagem/${t.id}">${esc(t.cidades.join(', '))}</a></td><td>${STATUS[t.status]}</td><td class="r">${brl(x.A)}</td><td class="r">${brl(x.G)}</td><td class="r">${brl(x.saldo)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma viagem.</p>'}
      <div class="row noprint" style="margin-top:16px"><button onclick="window.print()">Imprimir / salvar PDF</button></div></div>
  </div>`;
}

function vViagem(id) {
  const t = trips.find((x) => x.id === id);
  if (!t || (!isFin() && t.tecnicoId !== userId)) {
    return `<div class="view"><a class="back" href="#/">← voltar</a><div class="empty"><p>Viagem não encontrada.</p></div></div>`;
  }
  const x = totals(t);
  const owner = t.tecnicoId === userId;
  const open = ['em_viagem', 'correcao'].includes(t.status);
  const canDesp = owner && open;
  const canAdv = (owner && open) || (isFin() && t.status !== 'encerrada');
  const canClose = owner && open && (t.despesas.length > 0 || x.A > 0);
  const label = x.saldo > 0 ? 'o técnico devolve' : x.saldo < 0 ? 'a empresa reembolsa' : 'contas zeradas';

  const resumo = `<div class="panel summary">
    <div class="grid">
      <div class="stat"><div class="l">adiantado</div><div class="n">${brl(x.A)}</div></div>
      <div class="stat"><div class="l">gasto</div><div class="n">${brl(x.G)}</div></div>
      <div class="stat"><div class="l">${label}</div><div class="n blue">${brl(Math.abs(x.saldo))}</div></div>
    </div>
    <hr class="rule" style="border-top-width:1.5px">
    <div class="tw"><table><thead><tr><th>categoria</th><th class="r">adiantado</th><th class="r">gasto</th><th class="r">diferença</th></tr></thead>
    <tbody>${CATS.filter(([k]) => x.adiant[k] || x.gasto[k]).map(([k, n]) => `<tr><td>${n}</td><td class="r">${brl(x.adiant[k])}</td><td class="r">${brl(x.gasto[k])}</td><td class="r">${brl(x.adiant[k] - x.gasto[k])}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nada lançado ainda.</td></tr>'}</tbody></table></div>
  </div>`;

  const adv = canAdv ? `<form class="panel" data-form="adiant" data-id="${t.id}">
    <h3>Adiantamento</h3>
    <p class="muted" style="margin-top:0">${isFin() ? 'Quanto foi liberado, por finalidade.' : 'Quanto o financeiro passou para esta viagem (deixe em branco se nada).'}</p>
    ${advFields(t.adiantamento)}<button type="submit">Salvar adiantamento</button></form>` : '';

  const despesas = `<div class="panel"><h3>Despesas</h3>
    ${t.despesas.length ? `<div class="tw"><table>
      <thead><tr><th>data</th><th>categoria</th><th>descrição</th><th class="r">valor</th><th>nota</th>${canDesp ? '<th></th>' : ''}</tr></thead>
      <tbody>${t.despesas.map((d) => `<tr><td>${dt(d.data)}</td><td>${catName(d.categoria)}</td><td>${esc(d.obs)}</td><td class="r">${brl(d.valor)}</td>
        <td>${d.arquivoId ? `<button data-act="ver" data-file="${esc(d.arquivoId)}">Ver</button>` : '<span class="muted">—</span>'}</td>
        ${canDesp ? `<td><button class="danger" data-act="del-desp" data-id="${t.id}" data-d="${d.id}" aria-label="Remover despesa">Remover</button></td>` : ''}</tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">total</td><td class="r">${brl(x.G)}</td><td></td>${canDesp ? '<td></td>' : ''}</tr></tfoot></table></div>`
      : '<p class="muted">Nenhuma despesa lançada.</p>'}
    ${canDesp ? `<hr class="rule"><form data-form="desp" data-id="${t.id}">
      <h3 style="font-size:18px">Adicionar despesa</h3>
      <div class="grid">
        <div class="fld"><label class="f" for="d-data">data</label><input id="d-data" name="data" type="date" required value="${today()}"></div>
        <div class="fld"><label class="f" for="d-cat">categoria</label><select id="d-cat" name="categoria">${CATS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
        <div class="fld"><label class="f" for="d-val">valor (R$)</label><input id="d-val" name="valor" type="number" inputmode="decimal" min="0.01" step="0.01" required placeholder="0,00"></div>
      </div>
      <div class="fld"><label class="f" for="d-obs">descrição</label><input id="d-obs" name="obs" placeholder="ex.: almoço (opcional)"></div>
      <div class="fld"><label class="f" for="d-arq">foto ou PDF da nota</label><input id="d-arq" name="arquivo" type="file" accept="image/*,application/pdf" required>
        <div class="hint">Foto da nota fiscal ou do cupom.</div></div>
      <button class="primary" type="submit">Registrar despesa</button></form>` : ''}</div>`;

  let acao = '';
  if (t.status === 'correcao' && t.correcao) acao += `<div class="alert"><b>Correção pedida:</b> ${esc(t.correcao)}</div>`;
  if (canClose) acao += `<form class="panel" data-form="assinar" data-id="${t.id}">
      <h3>Fechar e assinar</h3>
      <p class="muted" style="margin-top:0">Ao assinar, a prestação vai para o financeiro e você não edita mais até ele conferir.</p>
      <div class="fld"><label class="chk"><input type="checkbox" name="ok" required> <span>Declaro que os valores e as notas lançados são verdadeiros e foram gastos a serviço desta viagem.</span></label></div>
      <div class="fld"><label class="f" for="ass">digite seu nome para assinar</label><input id="ass" name="nome" required placeholder="${esc(me().nome)}"></div>
      <button class="primary" type="submit">Assinar e enviar</button></form>`;
  if (t.assinatura) acao += `<div class="alert"><span>Assinado eletronicamente por <b>${esc(t.assinatura.nome)}</b> em ${dtt(t.assinatura.em)}</span></div>`;
  if (isFin() && t.status === 'enviada') acao += `<div class="panel"><h3>Conferência</h3>
      <div class="row"><button class="primary" data-act="aprovar" data-id="${t.id}">Aprovar prestação</button></div>
      <hr class="rule"><form data-form="correcao" data-id="${t.id}">
      <div class="fld"><label class="f" for="mot">ou peça correção ao técnico</label><textarea id="mot" name="motivo" required placeholder="o que precisa ser ajustado?"></textarea></div>
      <button type="submit">Pedir correção</button></form></div>`;
  if (isFin() && t.status === 'conferida') acao += `<form class="panel" data-form="acerto" data-id="${t.id}">
      <h3>Acerto</h3>
      <p style="margin-top:0">${x.saldo < 0 ? `Reembolsar <b>${brl(-x.saldo)}</b> para ${esc(userName(t.tecnicoId))}.` : `${esc(userName(t.tecnicoId))} devolve <b>${brl(x.saldo)}</b>.`}</p>
      <div class="fld"><label class="f" for="ac-obs">observação</label><input id="ac-obs" name="obs" placeholder="ex.: pix enviado (opcional)"></div>
      <button class="primary" type="submit">${x.saldo < 0 ? 'Registrar reembolso pago' : 'Registrar devolução recebida'}</button></form>`;
  if (t.status === 'conferida' && !isFin()) acao += `<div class="alert">Aprovada. Aguardando o acerto de ${x.saldo < 0 ? 'reembolso' : 'devolução'} de ${brl(Math.abs(x.saldo))}</div>`;
  if (t.status === 'enviada' && !isFin()) acao += `<div class="alert">Enviada ao financeiro. Aguardando conferência.</div>`;
  if (t.status === 'encerrada') acao += `<div class="alert">Viagem encerrada${t.acerto ? ` · ${t.acerto.tipo === 'reembolso' ? 'reembolso pago' : 'devolução recebida'}: ${brl(t.acerto.valor)} (${dtt(t.acerto.em)})` : ''}</div>`;

  return `<div class="view">
    <a class="back" href="#/">← voltar</a>
    <div class="head"><span class="tag s-${t.status}">${STATUS[t.status]}</span>
      <h1 style="margin-top:12px">Viagem de ${esc(userName(t.tecnicoId))}</h1>
      <p class="sub">${esc(t.cidades.join(' · '))} · ${dt(t.ida)}${t.volta && t.volta !== t.ida ? ' → ' + dt(t.volta) : ''}${t.finalidade ? ' · ' + esc(t.finalidade) : ''}</p></div>
    ${acao}${resumo}${adv}${despesas}
    <div class="panel"><h3>Histórico</h3><ul class="hist">${t.historico.slice().reverse().map((h) => `<li><span class="t">${dtt(h.em)} · ${esc(h.por)}</span>${esc(h.texto)}</li>`).join('')}</ul>
      ${owner && t.status === 'em_viagem' ? `<div class="row" style="margin-top:14px"><button class="danger" data-act="excluir" data-id="${t.id}">Excluir viagem</button></div>` : ''}</div>
  </div>`;
}

/* ---------- roteador ---------- */
function vLogin() {
  return `<div class="view">
    <div class="head"><h1>Entrar</h1><p>Acesse com o e-mail e a senha cadastrados pelo financeiro.</p></div>
    <form class="panel" data-form="login" style="max-width:420px">
      ${authMsg ? `<div class="alert" role="alert">${esc(authMsg)}</div>` : ''}
      <div class="fld"><label class="f" for="lg-email">e-mail</label><input id="lg-email" name="email" type="email" autocomplete="username" required></div>
      <div class="fld"><label class="f" for="lg-senha">senha</label><input id="lg-senha" name="senha" type="password" autocomplete="current-password" required></div>
      <button class="primary" type="submit">Entrar</button>
    </form></div>`;
}

function route() {
  if (!userId) { chrome(''); $('#app').innerHTML = vLogin(); return; }
  const h = location.hash || '#/';
  let html; let key = h;
  if (h.startsWith('#/viagem/')) { html = vViagem(h.slice(9)); key = ''; }
  else if (h === '#/nova') html = vNova();
  else if (h === '#/fila') html = vFila();
  else if (h === '#/relatorio') html = vRelatorio();
  else { html = vPainel(); key = '#/'; }
  chrome(key);
  $('#app').innerHTML = html;
}

async function refresh(msg) { await load(); route(); if (msg) toast(msg); }

/* ---------- ações ---------- */
async function mutate(id, fn, msg) {
  const t = trips.find((x) => x.id === id);
  if (!t) return;
  fn(t);
  await Store.save(t);
  await refresh(msg);
}

// Reduz fotos até caberem no limite do store (demo: 3 MB; Firebase: 700 KB).
const maxFile = () => Store.maxFile || 3 * 1024 * 1024;
async function compress(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    let out = file;
    for (const [dim, q] of [[1600, 0.72], [1280, 0.65], [1024, 0.6], [800, 0.55]]) {
      const k = Math.min(1, dim / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      out = await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', q));
      if (out.size <= maxFile()) break;
    }
    return out;
  } catch { return file; }
}

const forms = {
  async login(f) {
    const v = new FormData(f);
    try { await Store.login(String(v.get('email')).trim(), String(v.get('senha'))); }
    catch (err) { authMsg = 'E-mail ou senha incorretos.'; return route(); }
    authMsg = '';
    await boot();
  },
  async nova(f) {
    const v = new FormData(f);
    if (v.get('volta') < v.get('ida')) return toast('a volta não pode ser antes da ida');
    const cidades = [v.get('c1'), v.get('c2')].flatMap((c) => String(c || '').split(/[,;/]/)).map((c) => c.trim()).filter(Boolean);
    const adiantamento = {};
    CATS.forEach(([k]) => { adiantamento[k] = v.get('adv') === 'sim' ? r2(v.get('adv_' + k)) : 0; });
    const t = {
      id: Store.uid(), criadoEm: new Date().toISOString(),
      tecnicoId: isFin() ? v.get('tecnico') : userId,
      cidades, ida: v.get('ida'), volta: v.get('volta'), finalidade: String(v.get('finalidade') || '').trim(),
      adiantamento, status: 'em_viagem', despesas: [], assinatura: null, acerto: null, correcao: '', historico: [],
    };
    log(t, 'Viagem criada');
    await Store.save(t);
    await load();
    location.hash = '#/viagem/' + t.id;
    toast('viagem criada');
  },
  async adiant(f) {
    const v = new FormData(f);
    await mutate(f.dataset.id, (t) => {
      CATS.forEach(([k]) => { t.adiantamento[k] = r2(v.get('adv_' + k)); });
      log(t, 'Adiantamento definido: ' + brl(totals(t).A));
    }, 'adiantamento salvo');
  },
  async desp(f) {
    const v = new FormData(f);
    const file = v.get('arquivo');
    if (!file || !file.size) return toast('anexe a nota');
    if (!file.type.startsWith('image/') && file.size > maxFile()) return toast('PDF acima de ' + Math.round(maxFile() / 1024) + ' KB');
    const blob = await compress(file);
    const arquivoId = await Store.putFile(Store.uid(), blob, f.dataset.id);
    await mutate(f.dataset.id, (t) => {
      const d = { id: Store.uid(), data: v.get('data'), categoria: v.get('categoria'), valor: r2(v.get('valor')), obs: String(v.get('obs') || '').trim(), arquivoId, arquivoNome: file.name };
      t.despesas.push(d);
      log(t, `Despesa: ${catName(d.categoria)} ${brl(d.valor)}`);
    }, 'despesa registrada');
  },
  async assinar(f) {
    const v = new FormData(f);
    const nome = String(v.get('nome')).trim();
    if (nome.toLowerCase() !== me().nome.toLowerCase()) return toast('digite seu nome exatamente: ' + me().nome);
    await mutate(f.dataset.id, (t) => {
      t.assinatura = { nome, em: new Date().toISOString() };
      t.status = 'enviada'; t.correcao = '';
      log(t, 'Prestação assinada e enviada ao financeiro');
    }, 'enviada ao financeiro');
  },
  async correcao(f) {
    const motivo = String(new FormData(f).get('motivo')).trim();
    await mutate(f.dataset.id, (t) => {
      t.status = 'correcao'; t.correcao = motivo; t.assinatura = null;
      log(t, 'Correção pedida: ' + motivo);
    }, 'correção pedida ao técnico');
  },
  async acerto(f) {
    const obs = String(new FormData(f).get('obs') || '').trim();
    await mutate(f.dataset.id, (t) => {
      const s = totals(t).saldo;
      t.acerto = { tipo: s < 0 ? 'reembolso' : 'devolucao', valor: Math.abs(s), em: new Date().toISOString(), por: me().nome };
      t.status = 'encerrada';
      log(t, (s < 0 ? 'Reembolso pago: ' : 'Devolução recebida: ') + brl(Math.abs(s)) + (obs ? ' — ' + obs : ''));
    }, 'acerto registrado · viagem encerrada');
  },
};

const acts = {
  async aprovar(el) {
    await mutate(el.dataset.id, (t) => {
      const s = totals(t).saldo;
      t.status = s === 0 ? 'encerrada' : 'conferida';
      log(t, 'Prestação aprovada' + (s === 0 ? ' · contas zeradas, viagem encerrada' : ' · falta o acerto de ' + brl(Math.abs(s))));
    }, 'prestação aprovada');
  },
  async 'del-desp'(el) {
    if (!confirm('Remover esta despesa?')) return;
    let fid;
    await mutate(el.dataset.id, (t) => {
      const d = t.despesas.find((x) => x.id === el.dataset.d);
      if (!d) return;
      fid = d.arquivoId;
      t.despesas = t.despesas.filter((x) => x.id !== d.id);
      log(t, `Despesa removida: ${catName(d.categoria)} ${brl(d.valor)}`);
    }, 'despesa removida');
    if (fid) Store.delFile(fid);
  },
  async excluir(el) {
    if (!confirm('Excluir esta viagem e todas as notas anexadas? Não dá para desfazer.')) return;
    await Store.remove(el.dataset.id);
    location.hash = '#/';
    await refresh('viagem excluída');
  },
  async ver(el) {
    const w = window.open('', '_blank');
    const blob = await Store.getFile(el.dataset.file);
    if (!blob) { if (w) w.close(); return toast('arquivo não encontrado neste navegador'); }
    const url = URL.createObjectURL(blob);
    if (w) w.location = url; else location.href = url;
  },
  async demo() {
    const mk = (tec, cid, ida, volta, adv, desp, status, extra = {}) => ({
      id: Store.uid(), criadoEm: new Date(ida + 'T12:00:00').toISOString(), tecnicoId: tec, cidades: cid, ida, volta, finalidade: 'exemplo',
      adiantamento: Object.assign({ alimentacao: 0, abastecimento: 0, hospedagem: 0, outros: 0 }, adv),
      despesas: desp.map(([categoria, valor, obs]) => ({ id: Store.uid(), data: ida, categoria, valor, obs, arquivoId: null })),
      status, assinatura: status === 'em_viagem' ? null : { nome: userName(tec), em: new Date(ida + 'T20:00:00').toISOString() },
      acerto: null, correcao: '', historico: [{ em: new Date(ida + 'T08:00:00').toISOString(), por: userName(tec), texto: 'Viagem criada (exemplo)' }], ...extra,
    });
    await Store.save(mk('anderson', ['Maringá'], '2026-11-03', '2026-11-03', { alimentacao: 40 }, [['alimentacao', 30, 'almoço']], 'enviada'));
    await Store.save(mk('rogerio', ['Sarandi', 'Paiçandu'], '2026-11-04', '2026-11-05', { abastecimento: 120, alimentacao: 100, hospedagem: 80 }, [['abastecimento', 120, ''], ['alimentacao', 100, ''], ['hospedagem', 80, 'diária']], 'conferida'));
    await Store.save(mk('mario', ['Londrina'], '2026-11-06', '2026-11-06', {}, [['alimentacao', 45, 'almoço do bolso']], 'em_viagem'));
    await refresh('exemplos carregados');
  },
};

/* ---------- eventos ---------- */
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try { await forms[f.dataset.form](f); } catch (err) { console.error(err); toast('erro: ' + err.message); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) { e.preventDefault(); acts[el.dataset.act](el).catch((err) => { console.error(err); toast('erro: ' + err.message); }); }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'adv') $('#advbox').hidden = e.target.value !== 'sim';
});
$('#who').addEventListener('change', (e) => {
  userId = e.target.value;
  try { localStorage.setItem('cv.user', userId); } catch { /* ok */ }
  location.hash = '#/';
  route();
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

$('#logout').addEventListener('click', async () => {
  await Store.logout();
  userId = null; trips = []; authMsg = '';
  location.hash = '#/';
  route();
});

async function boot() {
  try {
    const s = await Store.init();
    if (Store.demo) {
      let id = null;
      try { id = localStorage.getItem('cv.user'); } catch { /* ok */ }
      userId = Store.USERS.some((u) => u.id === id) ? id : Store.USERS[0].id;
    } else if (s.user) {
      userId = s.user.id;
    } else {
      userId = null;
      if (s.semPerfil) { authMsg = 'Seu usuário ainda não tem perfil. Peça ao financeiro para liberar o acesso.'; await Store.logout(); }
    }
    if (userId) await load();
  } catch (err) {
    console.error(err);
    userId = null;
    authMsg = 'Erro ao conectar: ' + err.message;
  }
  route();
}
boot();
})();
