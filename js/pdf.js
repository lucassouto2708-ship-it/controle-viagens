/* Geração de PDF no navegador (pdf-lib): resumo da viagem + uma página por nota fiscal anexada.
   Aceita várias viagens de uma vez (fechamento de semana/quinzena/mês) e junta tudo em um único PDF. */
(() => {
  const L = window.PDFLib;
  if (!L) return;
  const { PDFDocument, StandardFonts, rgb } = L;
  const PW = 595.28; const PH = 841.89; const M = 40; const CW = PW - 2 * M;
  const BLUE = rgb(0.118, 0.306, 0.549); const INK = rgb(0.1, 0.1, 0.12); const GREY = rgb(0.42, 0.45, 0.5); const LINE = rgb(0.82, 0.85, 0.89);

  // As fontes padrão do PDF só têm o alfabeto latino (WinAnsi): troca o que não existe nele.
  const clean = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[→⟶]/g, '-').replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E -ÿ]/g, '?');

  async function imgToJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return out.arrayBuffer();
  }

  async function build(trips, ctx, opts = {}) {
    const { brl, dt, dtt, userName, catName, totals, CATS, STATUS, getFile } = ctx;
    const doc = await PDFDocument.create();
    doc.setTitle(opts.titulo || 'Prestação de contas de viagem'); doc.setCreator('Controle de Viagens');
    const F = await doc.embedFont(StandardFonts.Helvetica); const B = await doc.embedFont(StandardFonts.HelveticaBold);
    let page; let y;
    const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
    const wd = (s, f, sz) => f.widthOfTextAtSize(clean(s), sz);
    const wrap = (s, maxw, f, sz) => {
      const out = []; let cur = '';
      for (const word of clean(s).split(' ')) {
        let w = word;
        while (f.widthOfTextAtSize(w, sz) > maxw && w.length > 1) { // palavra maior que a coluna
          let n = w.length - 1; while (n > 1 && f.widthOfTextAtSize(w.slice(0, n), sz) > maxw) n--;
          if (cur) { out.push(cur); cur = ''; }
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        const t = cur ? cur + ' ' + w : w;
        if (cur && f.widthOfTextAtSize(t, sz) > maxw) { out.push(cur); cur = w; } else cur = t;
      }
      if (cur || !out.length) out.push(cur);
      return out;
    };
    const put = (s, x, o = {}) => page.drawText(clean(s), { x, y, size: o.size || 10, font: o.bold ? B : F, color: o.color || INK });
    const putR = (s, xr, o = {}) => put(s, xr - wd(s, o.bold ? B : F, o.size || 10), o);
    const need = (h) => { if (y - h < M + 24) newPage(); };
    const hr = () => { page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: LINE }); };
    const h2 = (s) => { need(34); y -= 8; put(s, M, { bold: true, size: 12, color: BLUE }); y -= 6; hr(); y -= 14; };
    const kv = (k, v) => {
      const lines = wrap(v || '-', CW - 90, F, 10);
      need(14 * lines.length);
      put(k, M, { size: 9, color: GREY });
      lines.forEach((ln, i) => { put(ln, M + 90, { size: 10 }); if (i < lines.length - 1) y -= 13; });
      y -= 15;
    };

    // cols: [{l, w, r}] — w em pontos, r = alinhado à direita
    const table = (cols, rows, foot) => {
      const sz = 9; const pad = 4;
      const head = () => {
        need(40); let x = M;
        page.drawRectangle({ x: M, y: y - 5, width: CW, height: 17, color: rgb(0.93, 0.95, 0.98) });
        cols.forEach((c) => { if (c.r) putR(c.l, x + c.w - pad, { size: 8, bold: true, color: GREY }); else put(c.l, x + pad, { size: 8, bold: true, color: GREY }); x += c.w; });
        y -= 20;
      };
      head();
      const row = (cells, bold) => {
        const wrapped = cells.map((c, i) => wrap(c, cols[i].w - 2 * pad, bold ? B : F, sz));
        const n = Math.max(...wrapped.map((a) => a.length));
        if (y - n * 12 < M + 30) { newPage(); head(); }
        let x = M; const top = y;
        wrapped.forEach((ls, i) => { ls.forEach((ln, j) => { y = top - j * 12; if (cols[i].r) putR(ln, x + cols[i].w - pad, { size: sz, bold }); else put(ln, x + pad, { size: sz, bold }); }); x += cols[i].w; });
        y = top - n * 12 - 1; hr(); y -= 9;
      };
      rows.forEach((r) => row(r, false));
      if (foot) row(foot, true);
      y -= 4;
    };

    const colsDesp = [{ l: 'Nº', w: 28 }, { l: 'DATA', w: 58 }, { l: 'CATEGORIA', w: 86 }, { l: 'DESCRIÇÃO', w: CW - 28 - 58 - 86 - 78 - 56 }, { l: 'VALOR', w: 78, r: true }, { l: 'NOTA', w: 56 }];

    // ---------- capa do período (fechamento) ----------
    if (opts.capa) {
      newPage();
      put('Fechamento de despesas de viagem', M, { bold: true, size: 17, color: BLUE }); y -= 20;
      put(opts.capa.periodo, M, { size: 12, bold: true }); y -= 14;
      put(opts.capa.filtro + ' · gerado em ' + dtt(new Date().toISOString()), M, { size: 9, color: GREY }); y -= 16; hr(); y -= 14;
      const tot = trips.map((t) => totals(t));
      const A = tot.reduce((s, x) => s + x.A, 0); const G = tot.reduce((s, x) => s + x.G, 0);
      kv('Viagens', String(trips.length)); kv('Adiantado', brl(A)); kv('Gasto declarado', brl(G));
      kv('Saldo', brl(Math.abs(A - G)) + (A - G > 0 ? ' (técnicos devolvem)' : A - G < 0 ? ' (empresa reembolsa)' : ' (zerado)'));
      h2('Por técnico');
      const porTec = new Map();
      trips.forEach((t, i) => { const k = userName(t.tecnicoId); const o = porTec.get(k) || { n: 0, A: 0, G: 0 }; o.n++; o.A += tot[i].A; o.G += tot[i].G; porTec.set(k, o); });
      table([{ l: 'TÉCNICO', w: CW - 40 - 3 * 80 }, { l: 'VIAGENS', w: 40, r: true }, { l: 'ADIANTADO', w: 80, r: true }, { l: 'GASTO', w: 80, r: true }, { l: 'SALDO', w: 80, r: true }],
        [...porTec.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, o]) => [k, String(o.n), brl(o.A), brl(o.G), brl(o.A - o.G)]));
      h2('Por categoria');
      table([{ l: 'CATEGORIA', w: CW - 90 }, { l: 'GASTO', w: 90, r: true }],
        CATS.map(([k, n]) => [n, brl(tot.reduce((s, x) => s + x.gasto[k], 0))]), ['Total', brl(G)]);
      h2('Viagens do período');
      table([{ l: 'IDA', w: 62 }, { l: 'TÉCNICO', w: 100 }, { l: 'CIDADES', w: CW - 62 - 100 - 3 * 70 }, { l: 'ADIANTADO', w: 70, r: true }, { l: 'GASTO', w: 70, r: true }, { l: 'SALDO', w: 70, r: true }],
        trips.map((t, i) => [dt(t.ida), userName(t.tecnicoId), t.cidades.join(', '), brl(tot[i].A), brl(tot[i].G), brl(tot[i].A - tot[i].G)]));
    }

    // ---------- uma viagem ----------
    for (const t of trips) {
      const x = totals(t);
      newPage();
      put('Prestação de contas de viagem', M, { bold: true, size: 16, color: BLUE });
      putR(STATUS[t.status] || t.status, PW - M, { size: 9, color: GREY }); y -= 22; hr(); y -= 16;
      kv('Técnico', userName(t.tecnicoId));
      kv('Cidades', t.cidades.join(' · '));
      kv('Período', dt(t.ida) + (t.volta && t.volta !== t.ida ? ' a ' + dt(t.volta) : ''));
      if (t.finalidade) kv('Finalidade', t.finalidade);
      kv('Adiantado', brl(x.A)); kv('Gasto declarado', brl(x.G));
      kv(x.saldo > 0 ? 'Técnico devolve' : x.saldo < 0 ? 'Empresa reembolsa' : 'Saldo', x.saldo === 0 ? 'contas zeradas' : brl(Math.abs(x.saldo)));

      h2('Por categoria');
      table([{ l: 'CATEGORIA', w: CW - 3 * 85 }, { l: 'ADIANTADO', w: 85, r: true }, { l: 'GASTO', w: 85, r: true }, { l: 'DIFERENÇA', w: 85, r: true }],
        CATS.filter(([k]) => x.adiant[k] || x.gasto[k]).map(([k, n]) => [n, brl(x.adiant[k]), brl(x.gasto[k]), brl(x.adiant[k] - x.gasto[k])]));

      h2('Despesas declaradas');
      table(colsDesp, t.despesas.map((d, i) => [String(i + 1), dt(d.data), catName(d.categoria), d.obs || '-', brl(d.valor), d.arquivoId ? 'Anexo ' + (i + 1) : 'sem nota']),
        ['', '', '', 'Total', brl(x.G), '']);

      h2('Assinatura e acerto');
      kv('Assinado por', t.assinatura ? `${t.assinatura.nome} em ${dtt(t.assinatura.em)} (assinatura eletrônica)` : 'não assinada');
      if (t.acerto) kv('Acerto', `${t.acerto.tipo === 'reembolso' ? 'Reembolso pago' : 'Devolução recebida'}: ${brl(t.acerto.valor)} em ${dtt(t.acerto.em)}${t.acerto.por ? ' (' + t.acerto.por + ')' : ''}`);
      h2('Histórico');
      (t.historico || []).forEach((h) => {
        const ls = wrap(`${dtt(h.em)} · ${h.por}: ${h.texto}`, CW, F, 8.5);
        need(11 * ls.length + 3); ls.forEach((ln) => { put(ln, M, { size: 8.5, color: GREY }); y -= 11; }); y -= 3;
      });

      // ---------- anexos: uma página por nota ----------
      for (let i = 0; i < t.despesas.length; i++) {
        const d = t.despesas[i];
        const header = (sfx) => {
          newPage();
          put(`Anexo ${i + 1} de ${t.despesas.length}${sfx || ''}`, M, { bold: true, size: 12, color: BLUE });
          putR(`${userName(t.tecnicoId)} · ${t.cidades.join(', ')} · ${dt(t.ida)}`, PW - M, { size: 8.5, color: GREY }); y -= 16;
          const ls = wrap(`${dt(d.data)} · ${catName(d.categoria)} · ${brl(d.valor)}${d.obs ? ' · ' + d.obs : ''}`, CW, B, 10);
          ls.forEach((ln) => { put(ln, M, { bold: true, size: 10 }); y -= 13; }); y -= 2; hr(); y -= 10;
        };
        const aviso = (msg) => { header(); put(msg, M, { size: 10, color: GREY }); };
        if (!d.arquivoId) { aviso('Nenhuma nota anexada a esta despesa.'); continue; }
        let blob = null;
        try { blob = await getFile(d.arquivoId); } catch { blob = null; }
        if (!blob) { aviso('Arquivo da nota não encontrado.'); continue; }
        const boxW = CW; const fits = (w, h) => { const boxH = y - (M + 22); const k = Math.min(boxW / w, boxH / h, 1.6); return [w * k, h * k, boxH]; };
        try {
          if ((blob.type || '').includes('pdf')) {
            const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
            const eps = await doc.embedPages(src.getPages());
            for (let p = 0; p < eps.length; p++) {
              header(eps.length > 1 ? ` (página ${p + 1}/${eps.length})` : '');
              const [w, h] = fits(eps[p].width, eps[p].height);
              page.drawPage(eps[p], { x: M + (boxW - w) / 2, y: y - h, width: w, height: h });
            }
          } else {
            const img = await doc.embedJpg(await imgToJpeg(blob));
            header();
            const [w, h] = fits(img.width, img.height);
            page.drawImage(img, { x: M + (boxW - w) / 2, y: y - h, width: w, height: h });
          }
        } catch (err) {
          console.error(err);
          aviso('Não foi possível incorporar este arquivo (' + (d.arquivoNome || 'nota') + ').');
        }
      }
    }

    // rodapé em todas as páginas
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      const s = clean(`Controle de Viagens · página ${i + 1} de ${pages.length}`);
      p.drawText(s, { x: PW - M - F.widthOfTextAtSize(s, 8), y: 22, size: 8, font: F, color: GREY });
    });
    return doc.save();
  }

  window.CVPdf = { build };
})();
