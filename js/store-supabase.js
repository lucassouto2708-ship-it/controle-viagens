/* Camada de dados em Supabase. Mesma interface do store.js (modo demo),
   mais login. O app.js escolhe qual usar conforme js/config.js. */
(() => {
  const cfg = window.CV_CONFIG || {};
  if (!cfg.url || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  const BUCKET = 'cv-comprovantes';
  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

  const S = {
    demo: false,
    USERS: [],
    uid: () => crypto.randomUUID(),

    async init() {
      const { data: { session }, error: e1 } = await sb.auth.getSession();
      fail(e1);
      if (!session) return { user: null };
      const { data, error } = await sb.from('cv_perfis').select('id,nome,papel,email,ativo');
      fail(error);
      const user = (data || []).find((p) => p.id === session.user.id);
      if (!user || user.ativo === false) return { user: null, semPerfil: true };
      S.USERS = data;
      return { user };
    },
    async login(email, senha) {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      fail(error);
    },
    async logout() { await sb.auth.signOut(); S.USERS = []; },

    // ---- equipe (só o master chama; o RLS garante) ----
    async listPerfis() {
      const { data, error } = await sb.from('cv_perfis').select('id,nome,papel,email,ativo').order('nome');
      fail(error);
      S.USERS = data;
      return data;
    },
    // Cria a conta de login por um cliente separado (sem sessão), para não trocar o usuário logado,
    // e cadastra o perfil com a sessão do master.
    async createUser({ nome, email, senha, papel }) {
      const sb2 = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await sb2.auth.signUp({ email, password: senha });
      fail(error);
      const u = data && data.user;
      if (!u || (u.identities && u.identities.length === 0)) throw new Error('User already registered');
      const { error: e2 } = await sb.from('cv_perfis').insert({ id: u.id, nome, papel, email, ativo: true });
      fail(e2);
    },
    async setAtivo(id, ativo) {
      const { error } = await sb.from('cv_perfis').update({ ativo }).eq('id', id);
      fail(error);
    },

    async list() {
      const { data, error } = await sb.from('cv_viagens')
        .select('*, despesas:cv_despesas(*), historico:cv_historico(*)')
        .order('criado_em', { ascending: false });
      fail(error);
      return data.map((v) => ({
        id: v.id, tecnicoId: v.tecnico_id, cidades: v.cidades, ida: v.ida, volta: v.volta,
        finalidade: v.finalidade, adiantamento: v.adiantamento || {}, status: v.status,
        assinatura: v.assinatura, acerto: v.acerto, correcao: v.correcao || '', criadoEm: v.criado_em,
        despesas: v.despesas.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em)).map((d) => ({
          id: d.id, data: d.data, categoria: d.categoria, valor: Number(d.valor), obs: d.obs,
          arquivoId: d.arquivo_path, arquivoNome: d.arquivo_nome,
        })),
        historico: v.historico.slice().sort((a, b) => a.id - b.id).map((h) => ({ id: h.id, em: h.em, por: h.por, texto: h.texto })),
      }));
    },

    async save(t) {
      const campos = {
        cidades: t.cidades, ida: t.ida, volta: t.volta, finalidade: t.finalidade,
        adiantamento: t.adiantamento, status: t.status, assinatura: t.assinatura,
        acerto: t.acerto, correcao: t.correcao || '',
      };
      const { data: ex, error: e0 } = await sb.from('cv_viagens').select('id').eq('id', t.id).maybeSingle();
      fail(e0);
      if (ex) {
        const { data, error } = await sb.from('cv_viagens').update(campos).eq('id', t.id).select('id');
        fail(error);
        if (!data.length) throw new Error('Sem permissão para alterar esta viagem neste status.');
      } else {
        const { error } = await sb.from('cv_viagens').insert({ id: t.id, tecnico_id: t.tecnicoId, criado_em: t.criadoEm, ...campos });
        fail(error);
      }
      // despesas: insere as novas, remove as que saíram
      const { data: cur, error: e1 } = await sb.from('cv_despesas').select('id').eq('viagem_id', t.id);
      fail(e1);
      const have = new Set(cur.map((d) => d.id));
      const want = new Set(t.despesas.map((d) => d.id));
      const novas = t.despesas.filter((d) => !have.has(d.id)).map((d) => ({
        id: d.id, viagem_id: t.id, data: d.data, categoria: d.categoria, valor: d.valor,
        obs: d.obs || '', arquivo_path: d.arquivoId || null, arquivo_nome: d.arquivoNome || null,
      }));
      if (novas.length) { const { error } = await sb.from('cv_despesas').insert(novas); fail(error); }
      const fora = [...have].filter((id) => !want.has(id));
      if (fora.length) { const { error } = await sb.from('cv_despesas').delete().in('id', fora); fail(error); }
      // histórico: só entradas novas (sem id)
      const hist = t.historico.filter((h) => h.id == null).map((h) => ({ viagem_id: t.id, em: h.em, por: h.por, texto: h.texto }));
      if (hist.length) { const { error } = await sb.from('cv_historico').insert(hist); fail(error); }
      return t;
    },

    async remove(id) {
      const { data } = await sb.from('cv_despesas').select('arquivo_path').eq('viagem_id', id);
      const paths = (data || []).map((d) => d.arquivo_path).filter(Boolean);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from('cv_viagens').delete().eq('id', id);
      fail(error);
    },

    // devolve o caminho no bucket (guardado em despesa.arquivoId)
    async putFile(_id, blob, viagemId) {
      const path = `${viagemId}/${crypto.randomUUID()}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream' });
      fail(error);
      return path;
    },
    async getFile(path) {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error) return null;
      return data;
    },
    async delFile(path) { await sb.storage.from(BUCKET).remove([path]); },
  };
  window.SupabaseStore = S;
})();
