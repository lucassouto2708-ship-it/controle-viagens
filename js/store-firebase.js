/* Camada de dados em Firebase (Auth + Firestore, plano gratuito).
   Mesma interface do store.js (modo demo), mais login.
   Comprovantes ficam no Firestore (subcoleção comprovantes, em base64),
   porque o Cloud Storage do Firebase exige plano pago. Limite: ~700 KB por arquivo. */
(() => {
  const cfg = (window.CV_CONFIG || {}).firebase;
  if (!cfg || !cfg.apiKey || !window.firebase) return;
  const app = window.firebase.initializeApp(cfg);
  const auth = window.firebase.auth(app);
  const db = window.firebase.firestore(app);
  const MAX_FILE = 700 * 1024;

  const clean = (o) => JSON.parse(JSON.stringify(o));
  const toB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const fromB64 = (b64, type) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  };
  const split = (path) => path.split('/');

  const S = {
    demo: false,
    maxFile: MAX_FILE,
    USERS: [],
    uid: () => crypto.randomUUID(),

    async init() {
      const user = await new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
      if (!user) return { user: null };
      const me = await db.collection('perfis').doc(user.uid).get();
      if (!me.exists || me.data().ativo === false) return { user: null, semPerfil: true };
      const perfil = { id: user.uid, nome: me.data().nome, papel: me.data().papel };
      if (perfil.papel === 'financeiro') {
        const all = await db.collection('perfis').get();
        S.USERS = all.docs.filter((d) => d.data().ativo !== false).map((d) => ({ id: d.id, nome: d.data().nome, papel: d.data().papel }));
      } else {
        S.USERS = [perfil];
      }
      return { user: perfil };
    },
    async login(email, senha) { await auth.signInWithEmailAndPassword(email, senha); },
    async logout() { await auth.signOut(); S.USERS = []; },

    async list() {
      const uid = auth.currentUser.uid;
      const fin = (S.USERS.find((u) => u.id === uid) || {}).papel === 'financeiro';
      const q = fin ? db.collection('viagens') : db.collection('viagens').where('tecnicoId', '==', uid);
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .map((t) => ({ despesas: [], historico: [], adiantamento: {}, ...t }))
        .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    },

    async save(t) {
      const { id, ...rest } = t;
      await db.collection('viagens').doc(id).set(clean(rest));
      return t;
    },

    async remove(id) {
      const files = await db.collection('viagens').doc(id).collection('comprovantes').get();
      await Promise.all(files.docs.map((d) => d.ref.delete()));
      await db.collection('viagens').doc(id).delete();
    },

    // devolve "viagemId/arquivoId" (guardado em despesa.arquivoId)
    async putFile(_id, blob, viagemId) {
      if (blob.size > MAX_FILE) throw new Error('Arquivo acima de 700 KB. Use uma foto menor ou um PDF mais leve.');
      const fid = crypto.randomUUID();
      await db.collection('viagens').doc(viagemId).collection('comprovantes').doc(fid)
        .set({ tipo: blob.type || 'application/octet-stream', dados: await toB64(blob), criadoEm: new Date().toISOString() });
      return `${viagemId}/${fid}`;
    },
    async getFile(path) {
      const [vid, fid] = split(path);
      const d = await db.collection('viagens').doc(vid).collection('comprovantes').doc(fid).get();
      return d.exists ? fromB64(d.data().dados, d.data().tipo) : null;
    },
    async delFile(path) {
      const [vid, fid] = split(path);
      await db.collection('viagens').doc(vid).collection('comprovantes').doc(fid).delete();
    },
  };
  window.FirebaseStore = S;
})();
