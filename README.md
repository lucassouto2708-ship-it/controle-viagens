# controle_viagens.app

Controle de despesas de viagem: técnico lança gastos com nota, assina e envia; o financeiro confere e acerta reembolso/devolução.

Front estático (HTML/CSS/JS puro). Dados hoje em localStorage + IndexedDB; a camada `js/store.js` é o ponto de troca para o Supabase.

## Supabase

1. Rode `supabase/schema.sql` no SQL Editor do projeto (tabelas `cv_*`, RLS e bucket `cv-comprovantes`).
2. Crie os usuários em Authentication > Users e cadastre cada um em `cv_perfis` (nome e papel `tecnico` ou `financeiro`).
3. Preencha `js/config.js` com a URL e a anon key do projeto. Com `url` vazio o app roda em modo demonstração.
