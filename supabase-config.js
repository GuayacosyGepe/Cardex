// CardDex — configuración pública de Supabase.
// La publishable key está diseñada para usarse en navegador SIEMPRE que RLS esté activo.
// NUNCA pongas aquí una secret key ni una service_role key.
window.CARDEX_SUPABASE = {
  url: 'https://oewawwmnwokpysxytxmy.supabase.co',
  key: 'sb_publishable_EOQNxcM-cuAG4UgJrvwOVw_yfh8a9l9'
};

// Carga de correcciones rápidas durante la beta. Se integrarán en la próxima versión completa.
const cardDexBetaFixes = document.createElement('link');
cardDexBetaFixes.rel = 'stylesheet';
cardDexBetaFixes.href = 'beta-fixes.css?v=20261003-2';
document.head.appendChild(cardDexBetaFixes);

const cardDexBetaScript = document.createElement('script');
cardDexBetaScript.src = 'beta-fixes.js?v=20261003-1';
document.head.appendChild(cardDexBetaScript);
