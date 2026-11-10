/* Camada de dados.
   Hoje: localStorage (viagens) + IndexedDB (comprovantes).
   Depois: trocar o corpo destas funções por chamadas ao Supabase
   (tabelas + Storage) mantendo a mesma interface — o app.js não muda. */
const Store = (() => {
  const KEY = 'controle_viagens.v1';

  // Equipe de demonstração. No Supabase vira tabela `perfis` + Auth.
  const USERS = [
    { id: 'anderson', nome: 'Anderson', papel: 'tecnico' },
    { id: 'rogerio',  nome: 'Rogério',  papel: 'tecnico' },
    { id: 'mario',    nome: 'Mário',    papel: 'tecnico' },
    { id: 'marli',    nome: 'Marli',    papel: 'financeiro' },
  ];

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = (v) => localStorage.setItem(KEY, JSON.stringify(v));

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  // ---- arquivos (comprovantes) ----
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('controle_viagens_files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  async function putFile(id, blob) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('f', 'readwrite');
      tx.objectStore('f').put(blob, id);
      tx.oncomplete = () => res(id);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function getFile(id) {
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction('f').objectStore('f').get(id);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async function delFile(id) {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction('f', 'readwrite');
      tx.objectStore('f').delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }

  // ---- viagens ----
  async function list() { return read(); }
  async function save(trip) {
    const all = read();
    const i = all.findIndex((t) => t.id === trip.id);
    if (i >= 0) all[i] = trip; else all.push(trip);
    write(all);
    return trip;
  }
  async function remove(id) {
    const all = read();
    const t = all.find((x) => x.id === id);
    if (t) await Promise.all(t.despesas.filter((d) => d.arquivoId).map((d) => delFile(d.arquivoId)));
    write(all.filter((x) => x.id !== id));
  }

  return { USERS, uid, list, save, remove, putFile, getFile, delFile };
})();
