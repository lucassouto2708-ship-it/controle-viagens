# controle_viagens.app

Controle de despesas de viagem: técnico lança gastos com nota, assina e envia; o financeiro confere e acerta reembolso/devolução.

Front estático (HTML/CSS/JS puro). Dados hoje em localStorage + IndexedDB; a camada `js/store.js` é o ponto de troca para o Supabase.

## Firebase (gratuito, plano Spark)

1. Console Firebase: criar projeto, ativar Authentication (e-mail/senha) e Firestore Database.
2. Colar `firestore.rules` em Firestore > Regras e publicar.
3. Criar os usuários em Authentication e um documento `perfis/{uid}` para cada um: `nome`, `papel` (`tecnico` ou `financeiro`) e `ativo: true`.
4. Colar a config do app web em `js/config.js` (`firebase: { apiKey, authDomain, projectId, appId, ... }`). Sem isso o app roda em modo demonstração.

Comprovantes ficam no Firestore (base64, até 700 KB cada); o Cloud Storage do Firebase exige plano pago.
