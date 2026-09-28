let sets=[];
let seriesCatalog=[];
const API_ROOT='https://api.tcgdex.net/v2';
const API=`${API_ROOT}/es`;
const EXCLUDED_SERIES=new Set(['tcgp']); // TCGdex agrupa TODO Pokémon TCG Pocket en 'tcgp'; CardDex solo cataloga TCG físico.
const CATALOG_LANGS=['es','en'];
const THEME_KEY='carddex_theme_v1';
const VALID_THEMES=new Set(['dark','light','system']);
const systemThemeQuery=window.matchMedia('(prefers-color-scheme: dark)');

function loadThemePreference(){
  const saved=localStorage.getItem(THEME_KEY);
  return VALID_THEMES.has(saved)?saved:'dark';
}
function resolvedTheme(preference){
  return preference==='system'?(systemThemeQuery.matches?'dark':'light'):preference;
}
function applyTheme(preference,{persist=false}={}){
  const pref=VALID_THEMES.has(preference)?preference:'dark';
  const resolved=resolvedTheme(pref);
  document.documentElement.dataset.theme=resolved;
  document.documentElement.dataset.themePreference=pref;
  if(persist){
    localStorage.setItem(THEME_KEY,pref);
    if(typeof syncProfilePatch==='function') syncProfilePatch({theme:pref});
  }
  document.querySelectorAll('input[name="carddexTheme"]').forEach(input=>{input.checked=input.value===pref});
  const status=document.querySelector('#themeStatus');
  if(status){
    const label=pref==='dark'?'Oscuro':pref==='light'?'Claro':`Sistema · ${resolved==='dark'?'oscuro':'claro'}`;
    status.textContent=label;
  }
}
let themePreference=loadThemePreference();
applyTheme(themePreference);
systemThemeQuery.addEventListener?.('change',()=>{if(themePreference==='system')applyTheme('system')});

function apiFor(lang='es'){return `${API_ROOT}/${lang}`}
function assetUrl(url,format='webp'){
  if(!url)return '';
  return /\.(?:webp|png|jpg|jpeg)(?:\?|$)/i.test(url)?url:`${url}.${format}`;
}
function glowFromString(value){
  let h=0;for(const ch of String(value||''))h=(h*31+ch.charCodeAt(0))%360;
  return `hsl(${h} 58% 50%)`;
}
async function fetchJson(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function loadSeriesLanguage(lang){
  const briefs=(await fetchJson(`${apiFor(lang)}/series`)).filter(s=>!EXCLUDED_SERIES.has(s.id));
  const detailed=await Promise.allSettled(briefs.map(s=>fetchJson(`${apiFor(lang)}/series/${encodeURIComponent(s.id)}`)));
  return briefs.map((brief,i)=>detailed[i].status==='fulfilled'?detailed[i].value:{...brief,sets:[]});
}
function mergeCatalog(esSeries=[],enSeries=[]){
  const esMap=new Map(esSeries.map(s=>[s.id,s]));
  const enMap=new Map(enSeries.map(s=>[s.id,s]));
  // TCGdex lista las series históricamente; invertimos para enseñar primero la era más reciente.
  const orderedIds=[];
  [...enSeries,...esSeries].forEach(s=>{if(!orderedIds.includes(s.id))orderedIds.push(s.id)});
  orderedIds.reverse();
  seriesCatalog=orderedIds.map((id,seriesIndex)=>{
    const es=esMap.get(id), en=enMap.get(id);
    const primary=es||en;
    const esSets=new Map((es?.sets||[]).map(x=>[x.id,x]));
    const enSets=new Map((en?.sets||[]).map(x=>[x.id,x]));
    const setIds=[];
    [...(en?.sets||[]),...(es?.sets||[])].forEach(x=>{if(!setIds.includes(x.id))setIds.push(x.id)});
    setIds.reverse();
    const serie={
      id,
      name:es?.name||en?.name||id,
      logo:assetUrl(es?.logo||en?.logo||''),
      lang:es?'es':'en',
      rank:seriesIndex,
      sets:[]
    };
    serie.sets=setIds.map((setId,setIndex)=>{
      const esSet=esSets.get(setId), enSet=enSets.get(setId), src=esSet||enSet;
      return {
        id:setId,
        tcgId:setId,
        name:esSet?.name||enSet?.name||setId,
        code:setId,
        logo:assetUrl(esSet?.logo||enSet?.logo||''),
        symbol:assetUrl(esSet?.symbol||enSet?.symbol||''),
        total:src?.cardCount?.total||0,
        official:src?.cardCount?.official||0,
        cardCount:src?.cardCount||{},
        seriesId:id,
        seriesName:serie.name,
        lang:esSet?'es':'en',
        glow:glowFromString(`${id}-${setId}`),
        rank:setIndex
      };
    });
    return serie;
  }).filter(s=>s.sets.length);
  sets=seriesCatalog.flatMap(s=>s.sets);
}
async function loadCatalog(){
  setCatalogLoading(true);
  try{
    const [esResult,enResult]=await Promise.allSettled(CATALOG_LANGS.map(loadSeriesLanguage));
    const esSeries=esResult.status==='fulfilled'?esResult.value:[];
    const enSeries=enResult.status==='fulfilled'?enResult.value:[];
    if(!esSeries.length&&!enSeries.length)throw new Error('No catalog languages available');
    mergeCatalog(esSeries,enSeries);
    populateEraFilter();
    renderLibrary();
    renderMyCollectionSets();
    updateCatalogStats();
  }catch(err){
    console.error(err);
    $('#allCards').innerHTML='<div class="empty">No se pudo cargar el catálogo completo. CardDex necesita conexión a Internet para consultar TCGdex.</div>';
    $('#myCollectionSets').innerHTML='<div class="empty">No se pudo cargar el catálogo de expansiones.</div>';
    $('#catalogSummary').textContent='Catálogo no disponible';
  }finally{setCatalogLoading(false)}
}
function setCatalogLoading(isLoading){
  const input=$('#catalogSearch'),select=$('#eraFilter');
  if(input)input.disabled=isLoading;if(select)select.disabled=isLoading;
}


// Metadatos visuales propios de CardDex para tipos y rarezas.
const TYPE_META={
  Grass:{label:'Planta',icon:'✿',color:'#62b66f'},
  Fire:{label:'Fuego',icon:'▲',color:'#e56c50'},
  Water:{label:'Agua',icon:'◆',color:'#5798e8'},
  Lightning:{label:'Rayo',icon:'ϟ',color:'#e2c84d'},
  Psychic:{label:'Psíquico',icon:'✺',color:'#b676df'},
  Fighting:{label:'Lucha',icon:'✦',color:'#c88755'},
  Darkness:{label:'Oscuro',icon:'☾',color:'#74758a'},
  Metal:{label:'Metal',icon:'⬡',color:'#a7b1bd'},
  Dragon:{label:'Dragón',icon:'◇',color:'#c5a740'},
  Colorless:{label:'Incoloro',icon:'○',color:'#aeb4bd'},
  Fairy:{label:'Hada',icon:'✧',color:'#e594c8'}
};
const RARITY_META={
  Common:{label:'Común',symbol:'●',tone:'neutral'},
  Uncommon:{label:'Poco común',symbol:'◆',tone:'neutral'},
  Rare:{label:'Rara',symbol:'★',tone:'neutral'},
  'Double Rare':{label:'Doble rara',symbol:'★★',tone:'neutral'},
  'Illustration Rare':{label:'Ilustración rara',symbol:'★',tone:'gold'},
  'Ultra Rare':{label:'Ultra rara',symbol:'★★',tone:'silver'},
  'Special Illustration Rare':{label:'Ilustración especial rara',symbol:'★★',tone:'gold'},
  'Hyper Rare':{label:'Hiper rara',symbol:'★★★',tone:'gold'}
};
const STORAGE_KEY='carddex_collection_v1';
const WISHLIST_KEY='carddex_wishlist_v1';
const GOALS_KEY='carddex_goals_v1';
const cardDetailCache=new Map();
let collection=loadCollection();
let wishlist=loadWishlist();
let goals=loadGoals();
let activeGoalId=null;
let currentSet=null;
let currentSetCards=[];
let currentVisibleCards=[];
let currentCard=null;
let currentCardFull=null;
let currentExpansionMode='explore';
let currentPokemon=null;
let pokemonBackView='pokedex';
let pokemon=[];


/* -------------------- BACKEND / SUPABASE -------------------- */
const SUPABASE_CONFIG=window.CARDEX_SUPABASE||{};
let supabaseClient=null;
let remoteUser=null;
let remoteProfile=null;
let remoteDataReady=false;
let suppressRemoteSync=false;

function backendConfigured(){
  return Boolean(SUPABASE_CONFIG.url&&SUPABASE_CONFIG.key&&window.supabase?.createClient);
}
function initBackendClient(){
  if(!backendConfigured())return null;
  if(!supabaseClient){
    supabaseClient=window.supabase.createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  }
  return supabaseClient;
}
function remoteWritable(){return Boolean(supabaseClient&&remoteUser?.id&&remoteDataReady&&!suppressRemoteSync)}
function updateSyncUI(){
  const badge=document.querySelector('#syncStatusBadge');
  const copy=document.querySelector('#syncSettingsCopy');
  if(!badge||!copy)return;
  if(!backendConfigured()){
    badge.textContent='Local';copy.textContent='Tus datos se guardan actualmente en este navegador. Supabase todavía no está configurado.';return;
  }
  if(!remoteUser){badge.textContent='Sin sesión';copy.textContent='Supabase está preparado. Inicia sesión para sincronizar tus datos.';return}
  if(!remoteDataReady){badge.textContent='Sincronizando…';copy.textContent='Estamos cargando los datos de tu cuenta.';return}
  badge.textContent='Sincronizado';copy.textContent='Colección, deseados, objetivos, tema y avatar están vinculados a tu cuenta.';
}
async function syncProfilePatch(patch={}){
  if(!remoteWritable())return;
  const payload={user_id:remoteUser.id,updated_at:new Date().toISOString(),...patch};
  const {error}=await supabaseClient.from('profiles').upsert(payload,{onConflict:'user_id'});
  if(error)console.warn('CardDex profile sync:',error.message);
}
async function syncCollectionItem(cardId){
  if(!remoteWritable())return;
  const quantity=countFor(cardId);
  if(quantity<=0){
    const {error}=await supabaseClient.from('collection_items').delete().eq('user_id',remoteUser.id).eq('card_id',cardId);
    if(error)console.warn('CardDex collection delete:',error.message);
    return;
  }
  const {error}=await supabaseClient.from('collection_items').upsert({user_id:remoteUser.id,card_id:cardId,quantity,updated_at:new Date().toISOString()},{onConflict:'user_id,card_id'});
  if(error)console.warn('CardDex collection sync:',error.message);
}
async function syncWishlistFull(){
  if(!remoteWritable())return;
  const uid=remoteUser.id;
  const {error:deleteError}=await supabaseClient.from('wishlist_items').delete().eq('user_id',uid);
  if(deleteError){console.warn('CardDex wishlist clear:',deleteError.message);return}
  const rows=Object.values(wishlist||{}).filter(c=>countFor(c.id)===0).map(c=>({user_id:uid,card_id:c.id,created_at:new Date(c.addedAt||Date.now()).toISOString()}));
  if(rows.length){const {error}=await supabaseClient.from('wishlist_items').insert(rows);if(error)console.warn('CardDex wishlist sync:',error.message)}
}
async function syncGoalsFull(){
  if(!remoteWritable())return;
  const uid=remoteUser.id;
  const {error:cardsDeleteError}=await supabaseClient.from('goal_cards').delete().eq('user_id',uid);
  if(cardsDeleteError){console.warn('CardDex goal cards clear:',cardsDeleteError.message);return}
  const {error:goalsDeleteError}=await supabaseClient.from('goals').delete().eq('user_id',uid);
  if(goalsDeleteError){console.warn('CardDex goals clear:',goalsDeleteError.message);return}
  if(!goals.length)return;
  const goalRows=goals.map(g=>({id:g.id,user_id:uid,name:g.name,description:g.description||'',created_at:new Date(g.createdAt||Date.now()).toISOString(),updated_at:new Date().toISOString()}));
  const {error:gError}=await supabaseClient.from('goals').insert(goalRows);
  if(gError){console.warn('CardDex goals sync:',gError.message);return}
  const cardRows=[];
  goals.forEach(g=>(g.cards||[]).forEach(c=>cardRows.push({goal_id:g.id,user_id:uid,card_id:c.id,added_at:new Date(c.addedAt||Date.now()).toISOString()})));
  if(cardRows.length){const {error}=await supabaseClient.from('goal_cards').insert(cardRows);if(error)console.warn('CardDex goal cards sync:',error.message)}
}
function localStateHasData(){return uniqueOwned()>0||Object.keys(wishlist||{}).length>0||(goals||[]).length>0}
async function pushLocalStateToRemote(){
  if(!supabaseClient||!remoteUser?.id)return;
  const uid=remoteUser.id;
  await supabaseClient.from('profiles').upsert({user_id:uid,display_name:authUser?.name||'Entrenador',avatar_pokemon_id:Number(authUser?.avatarPokemonId)||25,avatar_style:authUser?.avatarStyle||'pixel',theme:themePreference,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  const collectionRows=Object.entries(collection||{}).filter(([,q])=>Number(q)>0).map(([cardId,quantity])=>({user_id:uid,card_id:cardId,quantity:Number(quantity),updated_at:new Date().toISOString()}));
  if(collectionRows.length)await supabaseClient.from('collection_items').upsert(collectionRows,{onConflict:'user_id,card_id'});
  remoteDataReady=true;
  await syncWishlistFull();await syncGoalsFull();
}
async function hydrateRemoteCardSnapshots(cardIds,localSnapshots=new Map()){
  const ids=[...new Set((cardIds||[]).filter(Boolean))];
  const result=new Map();
  ids.forEach(id=>{if(localSnapshots.has(id))result.set(id,localSnapshots.get(id))});
  const pending=ids.filter(id=>!result.has(id));
  const workerCount=Math.min(8,pending.length);
  let cursor=0;
  async function worker(){
    while(cursor<pending.length){
      const id=pending[cursor++];
      try{
        const full=await getCardDetail(id);
        const snapshot=cardSnapshot(full,full);
        if(snapshot)result.set(id,snapshot);
      }catch(err){
        console.warn('CardDex card hydrate:',id,err?.message||err);
        result.set(id,{id,name:'Carta'});
      }
    }
  }
  await Promise.all(Array.from({length:workerCount},()=>worker()));
  return result;
}
async function fetchRemoteState(){
  if(!supabaseClient||!remoteUser?.id)return;
  updateSyncUI();
  const uid=remoteUser.id;
  const [profileRes,collectionRes,wishlistRes,goalsRes,goalCardsRes]=await Promise.all([
    supabaseClient.from('profiles').select('*').eq('user_id',uid).maybeSingle(),
    supabaseClient.from('collection_items').select('card_id,quantity,updated_at').eq('user_id',uid),
    supabaseClient.from('wishlist_items').select('card_id,created_at').eq('user_id',uid),
    supabaseClient.from('goals').select('id,name,description,created_at,updated_at').eq('user_id',uid).order('created_at',{ascending:false}),
    supabaseClient.from('goal_cards').select('goal_id,card_id,added_at').eq('user_id',uid)
  ]);
  for(const res of [profileRes,collectionRes,wishlistRes,goalsRes,goalCardsRes])if(res.error)console.warn('CardDex remote load:',res.error.message);
  const remoteEmpty=!(collectionRes.data||[]).length&&!(wishlistRes.data||[]).length&&!(goalsRes.data||[]).length;
  if(remoteEmpty&&localStateHasData()){
    remoteDataReady=true;
    await pushLocalStateToRemote();
    return fetchRemoteState();
  }
  suppressRemoteSync=true;
  try{
    remoteProfile=profileRes.data||null;
    collection=Object.fromEntries((collectionRes.data||[]).map(row=>[row.card_id,Number(row.quantity)||0]));
    const localWishlistBefore=loadWishlist();
    const localGoalsBefore=loadGoals();
    const localCardSnapshots=new Map();
    Object.values(localWishlistBefore||{}).forEach(c=>{if(c?.id)localCardSnapshots.set(c.id,c)});
    (localGoalsBefore||[]).forEach(g=>(g.cards||[]).forEach(c=>{if(c?.id&&!localCardSnapshots.has(c.id))localCardSnapshots.set(c.id,c)}));

    const neededIds=[...new Set([
      ...(wishlistRes.data||[]).map(row=>row.card_id),
      ...(goalCardsRes.data||[]).map(row=>row.card_id)
    ].filter(Boolean))];
    const hydrated=await hydrateRemoteCardSnapshots(neededIds,localCardSnapshots);

    wishlist=Object.fromEntries((wishlistRes.data||[]).map(row=>[row.card_id,{...(hydrated.get(row.card_id)||{id:row.card_id,name:'Carta'}),addedAt:new Date(row.created_at).getTime()}]));
    const goalCardsByGoal=new Map();
    (goalCardsRes.data||[]).forEach(row=>{
      if(!goalCardsByGoal.has(row.goal_id))goalCardsByGoal.set(row.goal_id,[]);
      goalCardsByGoal.get(row.goal_id).push({...((hydrated.get(row.card_id))||{id:row.card_id,name:'Carta'}),id:row.card_id,addedAt:new Date(row.added_at).getTime()});
    });
    goals=(goalsRes.data||[]).map(row=>({id:row.id,name:row.name,description:row.description||'',createdAt:new Date(row.created_at).getTime(),cards:goalCardsByGoal.get(row.id)||[]}));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(collection));
    localStorage.setItem(WISHLIST_KEY,JSON.stringify(wishlist));
    localStorage.setItem(GOALS_KEY,JSON.stringify(goals));
    if(remoteProfile?.theme&&VALID_THEMES.has(remoteProfile.theme)){themePreference=remoteProfile.theme;applyTheme(themePreference);localStorage.setItem(THEME_KEY,themePreference)}
    authUser={...authUser,loggedIn:true,name:remoteProfile?.display_name||remoteUser.user_metadata?.display_name||remoteUser.email?.split('@')[0]||'Entrenador',email:remoteUser.email||'',avatarPokemonId:Number(remoteProfile?.avatar_pokemon_id)||25,avatarStyle:remoteProfile?.avatar_style||'pixel'};
    localStorage.setItem(AUTH_KEY,JSON.stringify(authUser));
  }finally{suppressRemoteSync=false}
  remoteDataReady=true;
  updateHomeStats();renderWishlist();renderGoals();updatePlanningBadges();updateGoalSelect();renderMyCollectionSets();renderAuthUser();updateSyncUI();
}
async function handleBackendSession(session){
  remoteUser=session?.user||null;remoteDataReady=false;
  if(!remoteUser){
    if(backendConfigured())authUser={...authUser,loggedIn:false,email:'',name:'',avatarPokemonId:authUser.avatarPokemonId||25,avatarStyle:authUser.avatarStyle||'pixel'};
    renderAuthUser();updateSyncUI();return;
  }
  authUser={...authUser,loggedIn:true,email:remoteUser.email||'',name:remoteUser.user_metadata?.display_name||remoteUser.email?.split('@')[0]||'Entrenador'};
  renderAuthUser();
  await fetchRemoteState();
}
async function initBackend(){
  const client=initBackendClient();updateSyncUI();
  if(!client)return;
  const {data}=await client.auth.getSession();
  await handleBackendSession(data.session);
  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='USER_UPDATED')setTimeout(()=>handleBackendSession(session),0);
  });
}

const $=sel=>document.querySelector(sel);
const $$=sel=>[...document.querySelectorAll(sel)];

function loadCollection(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{return {}}
}
function loadWishlist(){
  try{return JSON.parse(localStorage.getItem(WISHLIST_KEY)||'{}')||{}}catch{return {}}
}
function saveWishlist(){
  localStorage.setItem(WISHLIST_KEY,JSON.stringify(wishlist));
  if(!suppressRemoteSync)syncWishlistFull();
  renderWishlist();
  updatePlanningBadges();
}
function loadGoals(){
  try{
    const data=JSON.parse(localStorage.getItem(GOALS_KEY)||'[]');
    return Array.isArray(data)?data:[];
  }catch{return []}
}
function saveGoals(){
  localStorage.setItem(GOALS_KEY,JSON.stringify(goals));
  if(!suppressRemoteSync)syncGoalsFull();
  renderGoals();
  updatePlanningBadges();
  updateGoalSelect();
  if(activeGoalId)renderGoalDetail(activeGoalId);
}
function saveCollection(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(collection));
  updateHomeStats();
}
function countFor(cardId){return Number(collection[cardId]||0)}
function setCount(cardId,value){
  const n=Math.max(0,Math.floor(Number(value)||0));
  if(n===0) delete collection[cardId]; else collection[cardId]=n;
  // Deseados representa cartas pendientes. En cuanto consigues una copia,
  // deja de estar pendiente automáticamente, aunque siga dentro de sus objetivos.
  if(n>0 && wishlist[cardId]) delete wishlist[cardId];
  saveCollection();
  localStorage.setItem(WISHLIST_KEY,JSON.stringify(wishlist));
  if(!suppressRemoteSync){syncCollectionItem(cardId);syncWishlistFull();}
  if(currentCard?.id===cardId) $('#cardCount').textContent=n;
  refreshGridCards(cardId);
  updateCurrentSetProgress();
  renderWishlist();
  renderGoals();
  if(activeGoalId)renderGoalDetail(activeGoalId);
  updatePlanningBadges();
  updatePlanningControls(currentCard,currentCardFull);
}
function totalCopies(){return Object.values(collection).reduce((a,b)=>a+Number(b||0),0)}
function uniqueOwned(){return Object.values(collection).filter(v=>Number(v)>0).length}
function updateHomeStats(){
  $('#homeTotalCopies').textContent=totalCopies();
  $('#homeUniqueCards').textContent=uniqueOwned();
}

function getKnownSetOwned(setId){
  if(!setId)return 0;
  if(setId===currentSet?.tcgId && currentSetCards.length) return currentSetCards.filter(c=>countFor(c.id)>0).length;
  return Object.keys(collection).filter(cardId=>countFor(cardId)>0 && cardId.startsWith(`${setId}-`)).length;
}
function setTextFallbackMarkup(s,{hidden=false}={}){
  const code=String(s.code||s.tcgId||'').toUpperCase();
  return `<span class="set-logo-fallback set-logo-text-fallback"${hidden?' style="display:none"':''}>
    <strong>${escapeHtml(s.name)}</strong>${code?`<small>${escapeHtml(code)}</small>`:''}
  </span>`;
}
function setSymbolFallbackMarkup(s,{hidden=false}={}){
  const symbol=assetUrl(s.symbol);
  if(!symbol)return setTextFallbackMarkup(s,{hidden});
  const text=setTextFallbackMarkup(s,{hidden:true});
  return `<span class="set-main-symbol-fallback"${hidden?' style="display:none"':''}>
    <img loading="lazy" src="${symbol}" alt="Símbolo ${escapeHtml(s.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
    ${text}
  </span>`;
}
function setLogoMarkup(s){
  const logo=assetUrl(s.logo);
  if(logo){
    return `<img class="set-main-logo" loading="lazy" src="${logo}" alt="Logo ${escapeHtml(s.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`+
      setSymbolFallbackMarkup(s,{hidden:true});
  }
  return setSymbolFallbackMarkup(s);
}
function setSymbolMarkup(s){
  const symbol=assetUrl(s.symbol);
  if(!symbol)return '';
  return `<span class="set-symbol" title="Símbolo de ${escapeHtml(s.name)}"><img loading="lazy" src="${symbol}" alt="" onerror="this.parentElement.style.display='none'"></span>`;
}
function setCard(s,{myCollection=false}={}){
  const owned=getKnownSetOwned(s.tcgId);
  const total=s.total||0;
  const progress=total?Math.round(owned/total*100):0;
  const status=myCollection
    ? (total ? `${owned} / ${total} cartas · ${progress}%` : `${owned} cartas registradas`)
    : (total?`${total} cartas`:'Abrir expansión');
  return `<article class="card set-card" data-set-id="${escapeHtml(s.tcgId||'')}" style="--glow:${s.glow}">
    ${setSymbolMarkup(s)}
    <div class="art">${setLogoMarkup(s)}</div>
    <div class="set-card-copy">
      <h3>${escapeHtml(s.name)}</h3>
      <div class="meta"><span>${escapeHtml(s.seriesName||'Pokémon TCG')}</span><b>${escapeHtml(String(s.code||s.tcgId||''))}</b></div>
      <div class="set-status">${status}</div>
      ${myCollection?`<div class="progress" style="--p:${progress}%"><span></span></div>`:''}
    </div>
  </article>`;
}

const cards=$('#cards'), all=$('#allCards'), myCollectionSets=$('#myCollectionSets');
function seriesLogoMarkup(serie){
  const logo=assetUrl(serie.logo);
  return logo?`<img src="${logo}" alt="${escapeHtml(serie.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`:'';
}
function renderEraSections(container,list,{mode='explore'}={}){
  if(!list.length){
    container.innerHTML='<div class="empty">No encontramos expansiones que coincidan con esos filtros.</div>';
    return;
  }
  const bySeries=new Map();
  list.forEach(set=>{
    if(!bySeries.has(set.seriesId))bySeries.set(set.seriesId,[]);
    bySeries.get(set.seriesId).push(set);
  });
  const groups=seriesCatalog.filter(serie=>bySeries.has(serie.id));
  container.innerHTML=groups.map(serie=>{
    const groupSets=bySeries.get(serie.id)||[];
    return `<section class="era-group" data-series-id="${escapeHtml(serie.id)}">
      <div class="era-heading">
        <div class="era-logo">${seriesLogoMarkup(serie)}<span>${escapeHtml(serie.name)}</span></div>
        <div><h2>${escapeHtml(serie.name)}</h2><p>${groupSets.length} ${groupSets.length===1?'expansión':'expansiones'}</p></div>
      </div>
      <div class="cards era-cards">${groupSets.map(set=>setCard(set,{myCollection:mode==='collection'})).join('')}</div>
    </section>`;
  }).join('');
  attachExpansionHandlers(container,mode);
}
function filteredCatalogSets(){
  const q=normalizeText($('#catalogSearch')?.value||'');
  const era=$('#eraFilter')?.value||'';
  return sets.filter(s=>{
    const eraOk=!era||s.seriesId===era;
    const text=`${s.name} ${s.seriesName} ${s.code} ${s.tcgId}`;
    const queryOk=!q||normalizeText(text).includes(q);
    return eraOk&&queryOk;
  });
}
function renderLibrary(){
  cards.innerHTML=sets.slice(0,6).map(s=>setCard(s)).join('')||'<div class="empty">Cargando expansiones recientes…</div>';
  attachExpansionHandlers(cards,'explore');
  const filtered=filteredCatalogSets();
  renderEraSections(all,filtered,{mode:'explore'});
  const era=$('#eraFilter')?.value||'';
  const selectedEra=seriesCatalog.find(x=>x.id===era);
  if($('#catalogSummary'))$('#catalogSummary').textContent=`${filtered.length} ${filtered.length===1?'expansión':'expansiones'}${selectedEra?` · ${selectedEra.name}`:` · ${seriesCatalog.length} eras`}`;
  if($('#clearCatalogFilters'))$('#clearCatalogFilters').classList.toggle('visible',Boolean(($('#catalogSearch')?.value||'').trim()||era));
}
function attachExpansionHandlers(container,mode){
  container.querySelectorAll('.set-card[data-set-id]').forEach(el=>{
    if(!el.dataset.setId)return;
    el.addEventListener('click',()=>openExpansion(el.dataset.setId,mode));
  });
}
function renderMyCollectionSets(){
  renderEraSections(myCollectionSets,sets,{mode:'collection'});
}
function populateEraFilter(){
  const select=$('#eraFilter');
  if(!select)return;
  const current=select.value;
  select.innerHTML='<option value="">Todas las eras</option>'+seriesCatalog.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  if(seriesCatalog.some(s=>s.id===current))select.value=current;
}
function updateCatalogStats(){
  if($('#homeSetCount'))$('#homeSetCount').textContent=sets.length;
  if($('#homeSeriesCount'))$('#homeSeriesCount').textContent=`${seriesCatalog.length} eras disponibles`;
}
$('#catalogSearch')?.addEventListener('input',debounce(renderLibrary,120));
$('#eraFilter')?.addEventListener('change',renderLibrary);
$('#clearCatalogFilters')?.addEventListener('click',()=>{
  $('#catalogSearch').value='';$('#eraFilter').value='';renderLibrary();
});
updateHomeStats();

function showView(id,navId=id){
  $$('.view').forEach(v=>v.classList.remove('active-view'));
  $('#'+id)?.classList.add('active-view');
  $$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===navId));
  window.scrollTo({top:0,behavior:'instant'});
}
$$('.nav').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('#seeAll').onclick=()=>showView('expansions');
$$('input[name="carddexTheme"]').forEach(input=>input.addEventListener('change',()=>{
  if(!input.checked)return;
  themePreference=input.value;
  applyTheme(themePreference,{persist:true});
}));
applyTheme(themePreference);

function normalizeText(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function findPokemonExact(q){
  const n=normalizeText(q);
  return pokemon.find(p=>normalizeText(prettyName(p.name))===n || String(p.id)===n) || null;
}

$('#search').addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const q=e.currentTarget.value.trim();
  if(!q)return;
  const p=findPokemonExact(q);
  if(p){openPokemonCards(p,'finder');return;}
  $('#finderSearch').value=q;
  showView('finder');
  runFinderSearch(q);
});

/* -------------------- EXPANSIONES -------------------- */
function resetExpansionFilters(){
  $('#expansionSearch').value='';
  $('#rarityFilter').value='';
  $('#typeFilter').value='';
  $('#filterPanel').hidden=true;
  $('#activeFilterCount').textContent='';
  $('#clearFilters').classList.remove('visible');
  updateFilterVisuals();
}
function getSetById(id){return sets.find(s=>s.tcgId===id||s.id===id)||null}
function preferredLanguagesForSet(set){
  const langs=[];
  [set?.lang,'es','en'].forEach(l=>{if(l&&!langs.includes(l))langs.push(l)});
  return langs;
}
async function fetchSetFull(set){
  let lastError;
  for(const lang of preferredLanguagesForSet(set)){
    try{
      const data=await fetchJson(`${apiFor(lang)}/sets/${encodeURIComponent(set.tcgId)}`);
      return {data,lang};
    }catch(err){lastError=err}
  }
  throw lastError||new Error('Set unavailable');
}
function currentSetApi(){return apiFor(currentSet?.lang||'es')}
function renderExpansionHeaderArt(set){
  const box=$('.set-detail-logo');
  if(!box)return;
  box.innerHTML=setLogoMarkup(set);
}

async function openExpansion(tcgId,mode='explore'){
  const set=getSetById(tcgId);
  if(!set)return;
  currentSet=set;
  currentSetCards=[];
  currentVisibleCards=[];
  currentExpansionMode=mode;
  currentPokemon=null;
  resetExpansionFilters();
  showView('expansionDetail',mode==='collection'?'mycollection':'expansions');
  $('#backFromExpansion').textContent=mode==='collection'?'← Mi colección':'← Expansiones';
  $('#expansionEyebrow').textContent=mode==='collection'?'MI COLECCIÓN':'EXPANSIÓN';
  $('#expansionSetTitle').textContent=set.name;
  renderExpansionHeaderArt(set);
  $('#expansionSetProgress').textContent='Cargando cartas…';
  $('#expansionProgressBar').style.width='0%';
  $('#expansionFilterInfo').textContent=`${set.seriesName||'Pokémon TCG'} · ${String(set.tcgId).toUpperCase()}`;
  renderCardSkeletons('#expansionCardGrid',18);
  try{
    const {data,lang}=await fetchSetFull(set);
    set.lang=lang;
    set.name=data.name||set.name;
    set.seriesName=data.serie?.name||set.seriesName;
    set.logo=assetUrl(data.logo||set.logo);
    set.symbol=assetUrl(data.symbol||set.symbol);
    set.releaseDate=data.releaseDate||set.releaseDate||'';
    currentSetCards=(data.cards||[]).slice().sort(sortCards);
    if(data.cardCount?.total)set.total=data.cardCount.total;
    if(data.cardCount?.official)set.official=data.cardCount.official;
    currentVisibleCards=[...currentSetCards];
    $('#expansionSetTitle').textContent=set.name;
    renderExpansionHeaderArt(set);
    renderExpansionCards(currentVisibleCards);
    updateCurrentSetProgress();
    const release=set.releaseDate?` · ${formatDate(set.releaseDate)}`:'';
    $('#expansionFilterInfo').textContent=`${set.seriesName||'Pokémon TCG'}${release}`;
    renderMyCollectionSets();
  }catch(err){
    console.error(err);
    $('#expansionCardGrid').innerHTML='<div class="empty">No hemos podido cargar las cartas de esta expansión. Comprueba tu conexión a Internet.</div>';
    $('#expansionFilterInfo').textContent='Las cartas se cargan desde TCGdex en este prototipo.';
    $('#expansionSetProgress').textContent='No disponible';
  }
}
$('#backFromExpansion').addEventListener('click',()=>showView(currentExpansionMode==='collection'?'mycollection':'expansions'));

function sortCards(a,b){
  const an=parseInt(a.localId,10),bn=parseInt(b.localId,10);
  if(Number.isFinite(an)&&Number.isFinite(bn)&&an!==bn)return an-bn;
  return String(a.localId).localeCompare(String(b.localId),undefined,{numeric:true});
}
function imageUrl(card,quality='low'){
  if(!card?.image)return '';
  return `${card.image}/${quality}.webp`;
}
function renderCardSkeletons(selector,count=18){
  $(selector).innerHTML=Array.from({length:count},()=>'<div class="skeleton-card"></div>').join('');
}
function cardTile(card,{collectionMode=false}={}){
  const count=countFor(card.id), owned=count>0;
  const img=imageUrl(card,'low');
  return `<article class="tcg-card ${owned?'owned':''}" data-card-id="${escapeHtml(card.id)}">
    <span class="owned-badge">×${count}</span>
    <div class="tcg-card-image">${img?`<img loading="lazy" src="${img}" alt="${escapeHtml(card.name)}">`:'<span class="no-card-image">Sin imagen</span>'}</div>
    <div class="tcg-card-name">${escapeHtml(card.name)}</div>
    <div class="tcg-card-number">#${escapeHtml(String(card.localId))}</div>
  </article>`;
}
function renderExpansionCards(list){
  const grid=$('#expansionCardGrid');
  grid.classList.toggle('collection-mode',currentExpansionMode==='collection');
  currentVisibleCards=list;
  grid.innerHTML=list.map(card=>cardTile(card,{collectionMode:currentExpansionMode==='collection'})).join('')||'<div class="empty">No hay cartas que coincidan con esos filtros.</div>';
  attachCardHandlers(grid);
}
function attachCardHandlers(container){
  container.querySelectorAll('.tcg-card').forEach(el=>el.addEventListener('click',()=>openCard(el.dataset.cardId)));
}
function refreshGridCards(cardId){
  document.querySelectorAll(`.tcg-card[data-card-id="${CSS.escape(cardId)}"]`).forEach(el=>{
    const count=countFor(cardId);
    el.classList.toggle('owned',count>0);
    const badge=el.querySelector('.owned-badge');
    if(badge)badge.textContent=`×${count}`;
  });
}
function updateCurrentSetProgress(){
  if(!currentSet||!currentSetCards.length)return;
  const owned=currentSetCards.filter(c=>countFor(c.id)>0).length;
  const total=currentSetCards.length||currentSet.total||0;
  const pct=total?Math.round(owned/total*100):0;
  $('#expansionSetProgress').textContent=`${owned} / ${total} cartas · ${pct}%`;
  $('#expansionProgressBar').style.width=`${pct}%`;
  renderMyCollectionSets();
}

$('#filterToggle').addEventListener('click',()=>{$('#filterPanel').hidden=!$('#filterPanel').hidden});
$('#clearFilters').addEventListener('click',()=>{
  $('#expansionSearch').value='';
  $('#rarityFilter').value='';
  $('#typeFilter').value='';
  applyExpansionFilters();
});
$('#expansionSearch').addEventListener('input',debounce(applyExpansionFilters,180));
$('#rarityFilter').addEventListener('change',()=>{updateFilterVisuals();applyExpansionFilters()});
$('#typeFilter').addEventListener('change',()=>{updateFilterVisuals();applyExpansionFilters()});

async function filterSetByFullDetails(rarity,type){
  const cards=currentSetCards;
  const result=[];
  const workers=Array.from({length:10},async(_,workerIndex)=>{
    for(let i=workerIndex;i<cards.length;i+=10){
      const card=cards[i];
      try{
        const full=await getCardDetail(card.id);
        const rarityOk=!rarity||full?.rarity===rarity;
        const typeOk=!type||(Array.isArray(full?.types)&&full.types.includes(type));
        if(rarityOk&&typeOk) result.push(card);
      }catch{}
      if(i%30===0) $('#expansionFilterInfo').textContent='Comprobando datos de tipo y rareza…';
    }
  });
  await Promise.all(workers);
  return result.sort(sortCards);
}

async function applyExpansionFilters(){
  if(!currentSet)return;
  const q=normalizeText($('#expansionSearch').value);
  const rarity=$('#rarityFilter').value;
  const type=$('#typeFilter').value;
  updateFilterVisuals();
  const active=[q,rarity,type].filter(Boolean).length;
  $('#activeFilterCount').textContent=active?`(${active})`:'';
  $('#clearFilters').classList.toggle('visible',active>0);

  let base=currentSetCards;
  if(rarity||type){
    $('#expansionFilterInfo').textContent='Aplicando filtros…';
    try{
      const params=new URLSearchParams();
      params.set('set.id',`eq:${currentSet.tcgId}`);
      if(rarity) params.set('rarity',`eq:${rarity}`);
      if(type) params.set('types',`eq:${type}`);
      const r=await fetch(`${currentSetApi()}/cards?${params.toString()}`);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      base=(await r.json()).slice().sort(sortCards);
      // Algunas combinaciones sobre campos-array pueden devolver 0 en el endpoint
      // de listado. En ese caso verificamos los detalles completos y filtramos aquí.
      if(!base.length&&type) base=await filterSetByFullDetails(rarity,type);
    }catch{
      base=await filterSetByFullDetails(rarity,type);
    }
  }
  const filtered=base.filter(c=>!q || normalizeText(c.name).includes(q) || normalizeText(c.localId).includes(q));
  renderExpansionCards(filtered);
  $('#expansionFilterInfo').textContent=`${filtered.length} ${filtered.length===1?'carta':'cartas'} mostradas${active?' con los filtros actuales':''}.`;
}

/* -------------------- FICHA DE CARTA -------------------- */
async function getCardDetail(cardId){
  if(cardDetailCache.has(cardId))return cardDetailCache.get(cardId);
  const setId=String(cardId).split('-').slice(0,-1).join('-')||String(cardId).split('-')[0];
  const set=getSetById(setId)||currentSet;
  let lastError;
  for(const lang of preferredLanguagesForSet(set)){
    try{
      const data=await fetchJson(`${apiFor(lang)}/cards/${encodeURIComponent(cardId)}`);
      cardDetailCache.set(cardId,data);
      return data;
    }catch(err){lastError=err}
  }
  throw lastError||new Error('Card unavailable');
}
async function openCard(cardId){
  const contextCards=currentVisibleCards.length?currentVisibleCards:currentSetCards;
  const brief=contextCards.find(c=>c.id===cardId) || currentSetCards.find(c=>c.id===cardId);
  if(!brief)return;
  currentCard=brief;
  currentCardFull=null;
  fillCardModal(brief,null);
  $('#cardModal').classList.add('open');
  $('#cardModal').setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  try{
    currentCardFull=await getCardDetail(cardId);
    currentCardFull=await enrichCardmarketPricing(cardId,currentCardFull);
    if(currentCard?.id===cardId)fillCardModal(brief,currentCardFull);
  }catch{}
}
async function enrichCardmarketPricing(cardId,data){
  if(data?.pricing?.cardmarket)return data;
  try{
    const english=await fetchJson(`${apiFor('en')}/cards/${encodeURIComponent(cardId)}`);
    if(!english?.pricing?.cardmarket)return data;
    return {...data,pricing:{...(data?.pricing||{}),cardmarket:english.pricing.cardmarket}};
  }catch{return data}
}
function numericPrice(value){return typeof value==='number'&&Number.isFinite(value)?value:null}
function formatMarketMoney(value,unit='EUR'){
  const n=numericPrice(value);
  if(n===null)return '—';
  try{return new Intl.NumberFormat('es-ES',{style:'currency',currency:unit||'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(n)}
  catch{return `${n.toFixed(2)} ${unit||'EUR'}`}
}
function formatMarketUpdated(value){
  if(value===undefined||value===null||value==='')return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  return `Actualizado ${new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(d)}`;
}
function marketVariantData(market,suffix=''){
  const key=n=>suffix?`${n}-${suffix}`:n;
  const trend=numericPrice(market?.[key('trend')]);
  const avg=numericPrice(market?.[key('avg')]);
  const primary=trend??avg??numericPrice(market?.[key('avg7')])??numericPrice(market?.[key('avg30')])??numericPrice(market?.[key('low')]);
  if(primary===null)return null;
  return {
    primary,
    low:numericPrice(market?.[key('low')]),
    avg:numericPrice(market?.[key('avg')]),
    avg7:numericPrice(market?.[key('avg7')]),
    avg30:numericPrice(market?.[key('avg30')])
  };
}
function updateCardmarketPrice(full){
  const box=$('#cardmarketPriceBox');
  const content=$('#cardmarketPriceContent');
  const updated=$('#cardmarketUpdated');
  if(!box||!content)return;
  const market=full?.pricing?.cardmarket;
  if(!market){box.hidden=true;content.innerHTML='';if(updated)updated.textContent='';return}
  const price=marketVariantData(market,'');
  if(!price){box.hidden=true;content.innerHTML='';if(updated)updated.textContent='';return}
  const unit=market.unit||'EUR';
  content.innerHTML=`<div class="market-variant">
    <div class="market-main"><span>Valor orientativo</span><strong>${escapeHtml(formatMarketMoney(price.primary,unit))}</strong><small>tendencia / referencia</small></div>
    <div class="market-metrics">
      ${price.low!==null?`<span><small>Mínimo</small><b>${escapeHtml(formatMarketMoney(price.low,unit))}</b></span>`:''}
      ${price.avg!==null?`<span><small>Media</small><b>${escapeHtml(formatMarketMoney(price.avg,unit))}</b></span>`:''}
      ${price.avg7!==null?`<span><small>7 días</small><b>${escapeHtml(formatMarketMoney(price.avg7,unit))}</b></span>`:''}
      ${price.avg30!==null?`<span><small>30 días</small><b>${escapeHtml(formatMarketMoney(price.avg30,unit))}</b></span>`:''}
    </div>
  </div>`;
  if(updated)updated.textContent=formatMarketUpdated(market.updated);
  box.hidden=false;
}
function fillCardModal(brief,full){
  $('#cardModalImage').src=imageUrl(brief,'high');
  $('#cardModalImage').alt=brief.name;
  $('#cardModalTitle').textContent=brief.name;
  $('#cardModalSet').textContent=(full?.set?.name || currentSet?.name || currentPokemon?.displayName || 'CARTA').toUpperCase();
  $('#cardCount').textContent=countFor(brief.id);
  updateCardNavigation(brief.id);
  const setTotal=full?.set?.cardCount?.total || (currentSet?currentSetCards.length:null);
  const rows=[
    ['Número',escapeHtml(`#${brief.localId}${setTotal?` / ${setTotal}`:''}`)],
    ['Expansión',escapeHtml(full?.set?.name||currentSet?.name||'—')],
    ['Rareza',full?.rarity?rarityBadge(full.rarity):'—'],
    ['Categoría',escapeHtml(prettyCategory(full?.category)||'—')],
    ['Tipo',Array.isArray(full?.types)&&full.types.length?full.types.map(typeBadge).join(' '):'—'],
    ['Ilustrador',escapeHtml(full?.illustrator||'—')]
  ];
  $('#cardModalMeta').innerHTML=rows.map(([k,v])=>`<div class="detail-row"><span>${escapeHtml(k)}</span><span class="detail-value">${v}</span></div>`).join('');
  updateCardmarketPrice(full);
  updatePlanningControls(brief,full);
}
function updateCardNavigation(cardId){
  const contextCards=currentVisibleCards.length?currentVisibleCards:currentSetCards;
  const index=contextCards.findIndex(c=>c.id===cardId);
  const valid=index>=0;
  $('#prevCard').disabled=!valid||index===0;
  $('#nextCard').disabled=!valid||index===contextCards.length-1;
  $('#cardPosition').textContent=valid?`${index+1} de ${contextCards.length}`:'';
}
function navigateCard(direction){
  if(!currentCard)return;
  const contextCards=currentVisibleCards.length?currentVisibleCards:currentSetCards;
  const index=contextCards.findIndex(c=>c.id===currentCard.id);
  const nextIndex=index+direction;
  if(index<0||nextIndex<0||nextIndex>=contextCards.length)return;
  openCard(contextCards[nextIndex].id);
}
$('#prevCard').addEventListener('click',e=>{e.stopPropagation();navigateCard(-1)});
$('#nextCard').addEventListener('click',e=>{e.stopPropagation();navigateCard(1)});
$('#increaseCard').addEventListener('click',()=>{if(currentCard)setCount(currentCard.id,countFor(currentCard.id)+1)});
$('#decreaseCard').addEventListener('click',()=>{if(currentCard)setCount(currentCard.id,countFor(currentCard.id)-1)});
function closeModal(){
  $('#cardModal').classList.remove('open');
  $('#cardModal').setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}
$$('[data-close-modal]').forEach(el=>el.addEventListener('click',closeModal));
document.addEventListener('keydown',e=>{
  const modalOpen=$('#cardModal').classList.contains('open');
  if(e.key==='Escape'&&modalOpen)closeModal();
  if(!modalOpen)return;
  if(e.key==='ArrowLeft')navigateCard(-1);
  if(e.key==='ArrowRight')navigateCard(1);
});

/* -------------------- POKÉDEX Y CARTAS POR POKÉMON -------------------- */
const pokeGrid=$('#pokeGrid');
const pokeSearch=$('#pokeSearch');
async function loadPokedex(){
  try{
    const r=await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=1025');
    const data=await r.json();
    pokemon=data.results.map((p,i)=>({id:i+1,name:p.name,displayName:prettyName(p.name)}));
    renderPokemon(pokemon);
  }catch{
    pokeGrid.innerHTML='<div class="empty">No se pudo cargar la Pokédex. Esta versión necesita conexión a Internet.</div>';
  }
}
function prettyName(n){return String(n).split('-').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ')}
function pokemonArtwork(id){return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`}
function pokeCard(p){
  return `<article class="poke-card" data-poke-id="${p.id}"><div class="poke-img"><img loading="lazy" src="${pokemonArtwork(p.id)}" alt="${escapeHtml(p.displayName||prettyName(p.name))}"></div><span>#${String(p.id).padStart(4,'0')}</span><h3>${escapeHtml(p.displayName||prettyName(p.name))}</h3><small>Ver sus cartas →</small></article>`;
}
function renderPokemon(list){
  pokeGrid.innerHTML=list.map(pokeCard).join('')||'<div class="empty">No encontramos ese Pokémon.</div>';
  pokeGrid.querySelectorAll('.poke-card').forEach(el=>el.addEventListener('click',()=>{
    const p=pokemon.find(x=>x.id===Number(el.dataset.pokeId));
    if(p)openPokemonCards(p,'pokedex');
  }));
}
pokeSearch.addEventListener('input',e=>{
  const q=normalizeText(e.target.value);
  renderPokemon(pokemon.filter(p=>normalizeText(p.displayName).includes(q)||String(p.id).includes(q)));
});

async function openPokemonCards(p,backView='pokedex'){
  if(!p)return;
  currentPokemon=p;
  currentSet=null;
  currentSetCards=[];
  currentVisibleCards=[];
  pokemonBackView=backView;
  showView('pokemonCards',backView==='finder'?'finder':'pokedex');
  $('#backFromPokemon').textContent=backView==='finder'?'← Buscador':'← Pokédex';
  $('#pokemonDetailImage').src=pokemonArtwork(p.id);
  $('#pokemonDetailImage').alt=p.displayName;
  $('#pokemonDetailNumber').textContent=`#${String(p.id).padStart(4,'0')}`;
  $('#pokemonDetailName').textContent=p.displayName;
  $('#pokemonCardCount').textContent='Buscando todas sus cartas…';
  $('#pokemonCardsNotice').textContent='';
  renderCardSkeletons('#pokemonCardGrid',20);
  try{
    // dexId es un array. Usamos igualdad estricta para evitar que, por ejemplo,
    // #25 coincida también con #125, #250, #425, etc.
    let r=await fetch(`${API}/cards?dexId=${encodeURIComponent(`eq:${p.id}`)}`);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    let list=await r.json();
    const pokemonName=normalizeText(p.displayName);
    if(Array.isArray(list)&&list.length){
      // Capa extra de seguridad ante respuestas laxas del backend.
      const sane=list.filter(card=>normalizeText(card.name).includes(pokemonName));
      if(sane.length) list=sane;
    }
    if(!Array.isArray(list)||!list.length){
      r=await fetch(`${API}/cards?name=${encodeURIComponent(p.displayName)}`);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      list=(await r.json()).filter(card=>normalizeText(card.name).includes(pokemonName));
    }
    currentVisibleCards=Array.isArray(list)?list:[];
    renderPokemonCardGrid(currentVisibleCards);
    $('#pokemonCardCount').textContent=`${currentVisibleCards.length} ${currentVisibleCards.length===1?'carta encontrada':'cartas encontradas'}`;
    $('#pokemonCardsNotice').textContent=currentVisibleCards.length?'Pulsa una carta para verla en detalle y añadirla a tu colección.':'';
  }catch{
    $('#pokemonCardGrid').innerHTML='<div class="empty">No hemos podido cargar las cartas de este Pokémon.</div>';
    $('#pokemonCardCount').textContent='No disponible';
    $('#pokemonCardsNotice').textContent='Este prototipo consulta TCGdex en tiempo real.';
  }
}
function renderPokemonCardGrid(list){
  const grid=$('#pokemonCardGrid');
  grid.classList.remove('collection-mode');
  grid.innerHTML=list.map(card=>cardTile(card)).join('')||'<div class="empty">No encontramos cartas disponibles para este Pokémon.</div>';
  attachCardHandlers(grid);
}
$('#backFromPokemon').addEventListener('click',()=>showView(pokemonBackView));

/* -------------------- BUSCADOR UNIVERSAL -------------------- */
$('#finderButton').addEventListener('click',()=>runFinderSearch($('#finderSearch').value));
$('#finderSearch').addEventListener('keydown',e=>{if(e.key==='Enter')runFinderSearch(e.currentTarget.value)});
async function runFinderSearch(raw){
  const q=String(raw||'').trim();
  const box=$('#finderResults');
  if(!q){box.innerHTML='<div class="empty">Escribe algo para empezar.</div>';return;}
  const exactPokemon=findPokemonExact(q);
  if(exactPokemon){
    openPokemonCards(exactPokemon,'finder');
    return;
  }
  box.innerHTML='<div class="search-loading">Buscando…</div>';
  const n=normalizeText(q);
  const pokeMatches=pokemon.filter(p=>normalizeText(p.displayName).includes(n)).slice(0,6);
  const setMatches=sets.filter(s=>normalizeText(s.name).includes(n)||normalizeText(s.code).includes(n)).slice(0,6);
  let cardMatches=[];
  try{
    const r=await fetch(`${API}/cards?name=${encodeURIComponent(q)}`);
    if(r.ok) cardMatches=(await r.json()).slice(0,24);
  }catch{}
  let html='';
  if(pokeMatches.length){
    html+=`<div class="result-section"><h3>Pokémon</h3><div class="finder-pokemon-row">${pokeMatches.map(p=>`<button class="finder-pokemon" data-poke-id="${p.id}"><img src="${pokemonArtwork(p.id)}" alt=""><span><b>${escapeHtml(p.displayName)}</b><small>#${String(p.id).padStart(4,'0')} · Ver todas sus cartas</small></span></button>`).join('')}</div></div>`;
  }
  if(setMatches.length){
    html+=`<div class="result-section"><h3>Expansiones</h3><div class="finder-set-row">${setMatches.map(s=>`<button class="finder-set" data-set-id="${s.tcgId||''}" ${s.tcgId?'':'disabled'}><img src="${s.logo}" alt=""><span>${escapeHtml(s.name)}</span></button>`).join('')}</div></div>`;
  }
  if(cardMatches.length){
    html+=`<div class="result-section"><h3>Cartas</h3><div id="finderCardGrid" class="tcg-grid compact-grid">${cardMatches.map(card=>cardTile(card)).join('')}</div></div>`;
  }
  box.innerHTML=html||'<div class="empty">No encontramos resultados.</div>';
  box.querySelectorAll('.finder-pokemon').forEach(el=>el.addEventListener('click',()=>{
    const p=pokemon.find(x=>x.id===Number(el.dataset.pokeId));
    if(p)openPokemonCards(p,'finder');
  }));
  box.querySelectorAll('.finder-set[data-set-id]').forEach(el=>{if(el.dataset.setId)el.addEventListener('click',()=>openExpansion(el.dataset.setId,'explore'))});
  const finderGrid=box.querySelector('#finderCardGrid');
  if(finderGrid){
    currentVisibleCards=cardMatches;
    currentSet=null;
    currentPokemon=null;
    attachCardHandlers(finderGrid);
  }
}


/* -------------------- DESEADOS Y OBJETIVOS -------------------- */
function cardSnapshot(brief=currentCard,full=currentCardFull){
  if(!brief)return null;
  const inferredSetId=String(brief.id||'').split('-').slice(0,-1).join('-');
  return {
    id:brief.id,
    name:brief.name||full?.name||'Carta',
    localId:brief.localId||full?.localId||'',
    image:brief.image||full?.image||'',
    setId:full?.set?.id||currentSet?.tcgId||inferredSetId,
    setName:full?.set?.name||currentSet?.name||'',
    addedAt:Date.now()
  };
}
function isWishlisted(cardId){return Boolean(wishlist?.[cardId])}
function addToWishlist(brief=currentCard,full=currentCardFull,{silent=false}={}){
  if(!brief)return false;
  if(countFor(brief.id)>0){
    if(!silent)setPlanningFeedback('Ya tienes esta carta en tu colección.');
    return false;
  }
  if(!wishlist[brief.id])wishlist[brief.id]=cardSnapshot(brief,full);
  saveWishlist();
  updatePlanningControls(brief,full);
  if(!silent)setPlanningFeedback('Añadida a Deseados.');
  return true;
}
function removeFromWishlist(cardId,{silent=false}={}){
  if(!wishlist[cardId])return;
  delete wishlist[cardId];
  saveWishlist();
  updatePlanningControls(currentCard,currentCardFull);
  if(!silent)setPlanningFeedback('Eliminada de Deseados.');
}
function toggleWishlist(){
  if(!currentCard)return;
  if(isWishlisted(currentCard.id))removeFromWishlist(currentCard.id);
  else addToWishlist(currentCard,currentCardFull);
}
function wishlistCards(){
  return Object.values(wishlist||{}).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
}
function renderWishlist(){
  const grid=$('#wishlistGrid');
  if(!grid)return;
  const list=wishlistCards().filter(c=>countFor(c.id)===0);
  grid.innerHTML=list.length?list.map(card=>cardTile(card,{collectionMode:true})).join(''):'<div class="empty">Todavía no has añadido cartas a Deseados. Abre una carta y pulsa “♡ Añadir”.</div>';
  grid.querySelectorAll('.tcg-card').forEach(el=>el.addEventListener('click',()=>{
    currentSet=null;currentPokemon=null;currentSetCards=[];currentVisibleCards=list;
    openCard(el.dataset.cardId);
  }));
}
function makeGoalId(){return `goal_${crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2,10)}`}`}
function getGoal(id){return goals.find(g=>g.id===id)||null}
function goalProgress(goal){
  const total=goal?.cards?.length||0;
  const owned=(goal?.cards||[]).filter(card=>countFor(card.id)>0).length;
  return {owned,total,pct:total?Math.round(owned/total*100):0};
}
function createGoal(name,description=''){
  const clean=String(name||'').trim();
  if(!clean)return null;
  const goal={id:makeGoalId(),name:clean,description:String(description||'').trim(),cards:[],createdAt:Date.now()};
  goals.unshift(goal);saveGoals();return goal;
}
function addCurrentCardToGoal(){
  if(!currentCard)return;
  const goalId=$('#goalSelect')?.value;
  if(!goalId){setPlanningFeedback('Selecciona primero un objetivo.');return}
  const goal=getGoal(goalId);if(!goal)return;
  goal.cards=Array.isArray(goal.cards)?goal.cards:[];
  if(goal.cards.some(c=>c.id===currentCard.id)){
    setPlanningFeedback('Esta carta ya forma parte del objetivo.');
    return;
  }
  const snapshot=cardSnapshot(currentCard,currentCardFull);
  goal.cards.push(snapshot);
  // Las cartas pendientes de un objetivo pasan también a Deseados.
  if(countFor(snapshot.id)===0 && !wishlist[snapshot.id])wishlist[snapshot.id]={...snapshot,addedAt:Date.now()};
  localStorage.setItem(WISHLIST_KEY,JSON.stringify(wishlist));
  if(!suppressRemoteSync)syncWishlistFull();
  saveGoals();renderWishlist();updatePlanningControls(currentCard,currentCardFull);
  setPlanningFeedback(`Añadida a “${goal.name}”.`);
}
function removeCardFromGoal(goalId,cardId){
  const goal=getGoal(goalId);if(!goal)return;
  goal.cards=(goal.cards||[]).filter(c=>c.id!==cardId);
  saveGoals();
}
function deleteActiveGoal(){
  const goal=getGoal(activeGoalId);if(!goal)return;
  if(!window.confirm(`¿Eliminar el objetivo “${goal.name}”? Las cartas no se borrarán de tu colección ni de Deseados.`))return;
  goals=goals.filter(g=>g.id!==goal.id);
  activeGoalId=null;
  localStorage.setItem(GOALS_KEY,JSON.stringify(goals));
  if(!suppressRemoteSync)syncGoalsFull();
  $('#goalDetail').hidden=true;$('#goalsGrid').hidden=false;
  renderGoals();updatePlanningBadges();updateGoalSelect();
}
function renderGoals(){
  const grid=$('#goalsGrid');if(!grid)return;
  if(!goals.length){grid.innerHTML='<div class="empty">Todavía no tienes objetivos. Crea uno y añade cartas desde sus fichas.</div>';return}
  grid.innerHTML=goals.map(goal=>{
    const p=goalProgress(goal);
    const previews=(goal.cards||[]).slice(0,4);
    return `<article class="goal-card" data-goal-id="${escapeHtml(goal.id)}">
      <div class="goal-card-preview">${previews.length?previews.map(c=>`<img src="${escapeHtml(imageUrl(c,'low'))}" alt="">`).join(''):'<span>＋</span>'}</div>
      <div class="goal-card-copy"><h3>${escapeHtml(goal.name)}</h3><p>${escapeHtml(goal.description||'Objetivo personalizado')}</p><strong>${p.owned} / ${p.total} · ${p.pct}%</strong><div class="progress" style="--p:${p.pct}%"><span></span></div></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('.goal-card').forEach(el=>el.addEventListener('click',()=>openGoalDetail(el.dataset.goalId)));
}
function openGoalDetail(goalId){
  activeGoalId=goalId;
  $('#goalsGrid').hidden=true;
  $('#goalCreatePanel').hidden=true;
  $('#goalDetail').hidden=false;
  renderGoalDetail(goalId);
}
function renderGoalDetail(goalId){
  const goal=getGoal(goalId);if(!goal)return;
  const p=goalProgress(goal);
  $('#goalDetailName').textContent=goal.name;
  $('#goalDetailDescription').textContent=goal.description||'Objetivo personalizado';
  $('#goalDetailProgress').textContent=`${p.owned} / ${p.total} · ${p.pct}%`;
  $('#goalDetailProgressBar').style.width=`${p.pct}%`;
  const grid=$('#goalCardGrid');
  const list=goal.cards||[];
  grid.innerHTML=list.length?list.map(card=>cardTile(card,{collectionMode:true})).join(''):'<div class="empty">Este objetivo todavía no tiene cartas. Añádelas desde la ficha de cualquier carta.</div>';
  grid.querySelectorAll('.tcg-card').forEach(el=>{
    const remove=document.createElement('button');
    remove.type='button';remove.className='goal-remove-card';remove.textContent='×';remove.title='Quitar del objetivo';
    remove.addEventListener('click',e=>{e.stopPropagation();removeCardFromGoal(goal.id,el.dataset.cardId)});
    el.appendChild(remove);
    el.addEventListener('click',()=>{
      currentSet=null;currentPokemon=null;currentSetCards=[];currentVisibleCards=list;
      openCard(el.dataset.cardId);
    });
  });
}
function updateGoalSelect(){
  const select=$('#goalSelect'),button=$('#addToGoalButton');if(!select||!button)return;
  const current=select.value;
  select.innerHTML='<option value="">Seleccionar objetivo…</option>'+goals.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
  if(goals.some(g=>g.id===current))select.value=current;
  select.disabled=!goals.length;
  button.disabled=!goals.length;
  updateGoalAddButton();
}
function updateGoalAddButton(){
  const select=$('#goalSelect'),button=$('#addToGoalButton');if(!select||!button)return;
  const goal=getGoal(select.value);
  const exists=Boolean(goal&&currentCard&&(goal.cards||[]).some(c=>c.id===currentCard.id));
  button.textContent=exists?'Añadida':'Añadir';
  button.disabled=!goals.length||!select.value||exists;
}
function updatePlanningControls(brief=currentCard,full=currentCardFull){
  const button=$('#wishlistToggle');
  if(button){
    if(!brief){button.disabled=true;button.textContent='♡ Añadir'}
    else if(countFor(brief.id)>0){button.disabled=true;button.classList.remove('active');button.textContent='✓ En colección'}
    else if(isWishlisted(brief.id)){button.disabled=false;button.classList.add('active');button.textContent='♥ En deseados'}
    else{button.disabled=false;button.classList.remove('active');button.textContent='♡ Añadir'}
  }
  updateGoalSelect();
  const feedback=$('#planningFeedback');if(feedback)feedback.textContent='';
}
function setPlanningFeedback(text){const el=$('#planningFeedback');if(el)el.textContent=text||''}
function updatePlanningBadges(){
  const w=$('#wishlistCountBadge'),g=$('#goalsCountBadge');
  if(w)w.textContent=wishlistCards().filter(c=>countFor(c.id)===0).length;
  if(g)g.textContent=goals.length;
}
function setCollectionTab(name){
  $$('.collection-tab').forEach(b=>b.classList.toggle('active',b.dataset.collectionTab===name));
  ['sets','wishlist','goals'].forEach(tab=>{
    const el=$(`#collectionTab${tab.charAt(0).toUpperCase()+tab.slice(1)}`);
    if(el){el.hidden=tab!==name;el.classList.toggle('active',tab===name)}
  });
  if(name==='wishlist')renderWishlist();
  if(name==='goals'){activeGoalId=null;$('#goalDetail').hidden=true;$('#goalsGrid').hidden=false;renderGoals()}
}
function initCollectionPlanning(){
  $$('.collection-tab').forEach(b=>b.addEventListener('click',()=>setCollectionTab(b.dataset.collectionTab)));
  $('#wishlistToggle')?.addEventListener('click',toggleWishlist);
  $('#goalSelect')?.addEventListener('change',updateGoalAddButton);
  $('#addToGoalButton')?.addEventListener('click',addCurrentCardToGoal);
  $('#newGoalButton')?.addEventListener('click',()=>{
    $('#goalCreatePanel').hidden=false;$('#goalNameInput').focus();
  });
  $('#cancelGoalButton')?.addEventListener('click',()=>{$('#goalCreatePanel').hidden=true;$('#goalNameInput').value='';$('#goalDescriptionInput').value=''});
  $('#saveGoalButton')?.addEventListener('click',()=>{
    const name=$('#goalNameInput').value,desc=$('#goalDescriptionInput').value;
    const goal=createGoal(name,desc);if(!goal){$('#goalNameInput').focus();return}
    $('#goalNameInput').value='';$('#goalDescriptionInput').value='';$('#goalCreatePanel').hidden=true;
    openGoalDetail(goal.id);
  });
  $('#goalNameInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#saveGoalButton').click()});
  $('#backToGoals')?.addEventListener('click',()=>{activeGoalId=null;$('#goalDetail').hidden=true;$('#goalsGrid').hidden=false;renderGoals()});
  $('#deleteGoalButton')?.addEventListener('click',deleteActiveGoal);
  renderWishlist();renderGoals();updatePlanningBadges();updateGoalSelect();
}

function translateType(v){return TYPE_META[v]?.label||v}
function translateRarity(v){return RARITY_META[v]?.label||v}
function typeBadge(v){
  const m=TYPE_META[v]||{label:v,icon:'•',color:'#8c94a6'};
  return `<span class="type-badge" style="--type-color:${escapeHtml(m.color)}"><i>${escapeHtml(m.icon)}</i>${escapeHtml(m.label)}</span>`;
}
function rarityBadge(v){
  const m=RARITY_META[v]||{label:v,symbol:'✦',tone:'neutral'};
  return `<span class="rarity-badge ${escapeHtml(m.tone)}"><i>${escapeHtml(m.symbol)}</i>${escapeHtml(m.label)}</span>`;
}
function updateFilterVisuals(){
  const type=$('#typeFilter')?.value;
  const rarity=$('#rarityFilter')?.value;
  const typePreview=$('#typeFilterPreview');
  const rarityPreview=$('#rarityFilterPreview');
  if(typePreview) typePreview.innerHTML=type?typeBadge(type):'<span class="filter-preview-muted">Todos los tipos</span>';
  if(rarityPreview) rarityPreview.innerHTML=rarity?rarityBadge(rarity):'<span class="filter-preview-muted">Todas las rarezas</span>';
}
function formatDate(v){
  if(!v)return '';
  const d=new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(d);
}
function prettyCategory(v){return v==='Pokemon'?'Pokémon':v==='Trainer'?'Entrenador':v==='Energy'?'Energía':v||''}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function debounce(fn,delay=180){let t;return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),delay)}}

initCollectionPlanning();
loadPokedex();
loadCatalog();


// CardDex 0.20 — autenticación preparada para Supabase con fallback local hasta configurar el proyecto.
const AUTH_KEY='carddex_auth_demo_v1';
const DEFAULT_AUTH_USER={loggedIn:false,name:'',email:'',avatarPokemonId:25,avatarStyle:'pixel'};
let authMode='login';
let authUser=loadAuthUser();

function loadAuthUser(){
  try{
    const saved=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
    return saved&&typeof saved==='object'?{...DEFAULT_AUTH_USER,...saved}: {...DEFAULT_AUTH_USER};
  }catch{return {...DEFAULT_AUTH_USER}}
}
function saveAuthUser(){
  localStorage.setItem(AUTH_KEY,JSON.stringify(authUser));
  renderAuthUser();
}
function renderAuthUser(){
  const logged=Boolean(authUser.loggedIn);
  const avatar=logged?authAvatarUrl(authUser):'avatar-placeholder.svg';
  const avatarButton=$('#userMenuButton');
  $('#userAvatarImage').src=avatar;
  $('#dropdownAvatarImage').src=avatar;
  avatarButton.classList.toggle('logged-out',!logged);
  $('#accountDisplayName').textContent=logged?(authUser.name||'Usuario CardDex'):'Invitado';
  $('#accountDisplayEmail').textContent=logged?(authUser.email||''):'Sin sesión iniciada';
  $('#accountModeLabel').textContent=logged?(remoteUser?'Sincronizado':'Modo local'):(backendConfigured()?'Supabase listo':'Modo local');
  $('#accountLoggedInMenu').hidden=!logged;
  $('#accountLoggedOutMenu').hidden=logged;
}
function toggleUserMenu(force){
  const menu=$('#userDropdown'),btn=$('#userMenuButton');
  const shouldOpen=typeof force==='boolean'?force:menu.hidden;
  menu.hidden=!shouldOpen;btn.setAttribute('aria-expanded',String(shouldOpen));
}
function closeUserMenu(){toggleUserMenu(false)}
function setAuthMode(mode){
  authMode=mode==='register'?'register':'login';
  const register=authMode==='register';
  $('#authModeLogin').classList.toggle('active',!register);
  $('#authModeRegister').classList.toggle('active',register);
  $('#authNameRow').hidden=!register;
  $('#authModalTitle').textContent=register?'Crear cuenta':'Iniciar sesión';
  $('#authIntro').textContent=register?'Crea tu cuenta para sincronizar tu colección en todos tus dispositivos.':'Inicia sesión para recuperar tu colección, deseados y objetivos.';
  $('#authSubmit').textContent=register?'Crear cuenta':'Entrar';
  const note=$('#authBackendNote');if(note)note.textContent=backendConfigured()?'La autenticación se gestiona con Supabase. CardDex no guarda tu contraseña.':'Supabase aún no está conectado. La cuenta real se activará al configurar el proyecto.';
  const feedback=$('#authFeedback');if(feedback){feedback.textContent='';feedback.className='auth-feedback'}
  $('#authPassword').setAttribute('autocomplete',register?'new-password':'current-password');
}
function openAuthModal(mode='login'){
  closeUserMenu();setAuthMode(mode);
  $('#authModal').hidden=false;$('#authModal').setAttribute('aria-hidden','false');
  $('#authEmail').value=authUser.email||'';
  $('#authPassword').value='';$('#authName').value=authUser.name||'';
  setTimeout(()=>$(mode==='register'?'#authName':'#authEmail')?.focus(),0);
}
function closeAuthModal(){
  $('#authModal').hidden=true;$('#authModal').setAttribute('aria-hidden','true');
}
async function logoutDemoUser(){
  closeUserMenu();
  if(supabaseClient&&remoteUser){await supabaseClient.auth.signOut();return}
  authUser={...authUser,loggedIn:false};saveAuthUser();
}
function navigateAccountShortcut(action){
  closeUserMenu();
  if(action==='collection'){showView('mycollection');setCollectionTab('sets')}
  if(action==='wishlist'){showView('mycollection');setCollectionTab('wishlist')}
  if(action==='goals'){showView('mycollection');setCollectionTab('goals')}
  if(action==='settings'){showView('settings')}
}
function avatarSpriteUrl(id,style='pixel'){
  const safeId=Math.max(1,Math.min(1025,Number(id)||25));
  if(style==='icon')return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-viii/icons/${safeId}.png`;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/${safeId}.png`;
}
function authAvatarUrl(user=authUser){
  // Compatibilidad con versiones anteriores: si existía una foto local, se conserva
  // hasta que el usuario elija un avatar Pokémon.
  if(user.avatar&&(!user.avatarPokemonId||user.avatar.startsWith('data:')))return user.avatar;
  return avatarSpriteUrl(user.avatarPokemonId||25,user.avatarStyle||'pixel');
}
let avatarPickerStyle='pixel';
function avatarPokemonList(){
  if(Array.isArray(pokemon)&&pokemon.length)return pokemon;
  return Array.from({length:1025},(_,i)=>({id:i+1,name:`pokemon-${i+1}`,displayName:`Pokémon #${i+1}`}));
}
function renderAvatarPicker(){
  const grid=$('#avatarPickerGrid');
  if(!grid)return;
  const q=normalizeText($('#avatarSearch')?.value||'');
  const list=avatarPokemonList().filter(p=>!q||normalizeText(p.displayName||p.name).includes(q)||String(p.id).includes(q));
  grid.innerHTML=list.map(p=>`<button type="button" class="avatar-choice ${Number(authUser.avatarPokemonId)===p.id&&authUser.avatarStyle===avatarPickerStyle?'selected':''}" data-avatar-pokemon="${p.id}" title="${escapeHtml(p.displayName||prettyName(p.name))}">
    <span class="avatar-choice-image"><img loading="lazy" src="${avatarSpriteUrl(p.id,avatarPickerStyle)}" alt=""></span>
    <strong>${escapeHtml(p.displayName||prettyName(p.name))}</strong><small>#${String(p.id).padStart(4,'0')}</small>
  </button>`).join('')||'<div class="empty">No encontramos ese Pokémon.</div>';
  grid.querySelectorAll('[data-avatar-pokemon]').forEach(button=>button.addEventListener('click',()=>{
    const id=Number(button.dataset.avatarPokemon);
    authUser={...authUser,avatarPokemonId:id,avatarStyle:avatarPickerStyle,avatar:null};
    saveAuthUser();syncProfilePatch({avatar_pokemon_id:id,avatar_style:avatarPickerStyle});renderAvatarPicker();closeAvatarPicker();
  }));
}
function setAvatarStyle(style){
  avatarPickerStyle=style==='icon'?'icon':'pixel';
  $$('[data-avatar-style]').forEach(btn=>btn.classList.toggle('active',btn.dataset.avatarStyle===avatarPickerStyle));
  renderAvatarPicker();
}
function openAvatarPicker(){
  closeUserMenu();
  avatarPickerStyle=authUser.avatarStyle||'pixel';
  $('#avatarModal').hidden=false;$('#avatarModal').setAttribute('aria-hidden','false');
  $('#avatarSearch').value='';
  setAvatarStyle(avatarPickerStyle);
  setTimeout(()=>$('#avatarSearch')?.focus(),0);
}
function closeAvatarPicker(){
  $('#avatarModal').hidden=true;$('#avatarModal').setAttribute('aria-hidden','true');
}
function initUserAccount(){
  renderAuthUser();
  $('#userMenuButton')?.addEventListener('click',e=>{e.stopPropagation();toggleUserMenu()});
  $('#userDropdown')?.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',()=>closeUserMenu());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeUserMenu();closeAuthModal();closeAvatarPicker()}});
  $$('[data-account-action]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.accountAction;
    if(['collection','wishlist','goals','settings'].includes(action))return navigateAccountShortcut(action);
    if(action==='avatar'){openAvatarPicker();return}
    if(action==='logout'){logoutDemoUser();return}
    if(action==='login'||action==='register'){openAuthModal(action);return}
  }));
  $$('[data-close-auth]').forEach(el=>el.addEventListener('click',closeAuthModal));
  $$('[data-close-avatar]').forEach(el=>el.addEventListener('click',closeAvatarPicker));
  $$('[data-avatar-style]').forEach(el=>el.addEventListener('click',()=>setAvatarStyle(el.dataset.avatarStyle)));
  $('#avatarSearch')?.addEventListener('input',debounce(renderAvatarPicker,120));
  $('#authModeLogin')?.addEventListener('click',()=>setAuthMode('login'));
  $('#authModeRegister')?.addEventListener('click',()=>setAuthMode('register'));
  $('#authForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const feedback=$('#authFeedback'),submit=$('#authSubmit');
    const email=$('#authEmail').value.trim();
    const password=$('#authPassword').value;
    const explicitName=$('#authName').value.trim();
    if(!backendConfigured()){
      feedback.textContent='Primero tenemos que conectar el proyecto de Supabase. Tus datos locales siguen intactos.';feedback.className='auth-feedback error';return;
    }
    submit.disabled=true;feedback.textContent='Conectando…';feedback.className='auth-feedback';
    try{
      if(authMode==='register'){
        const derived=(email.split('@')[0]||'Entrenador').replace(/[._-]+/g,' ');
        const displayName=explicitName||derived.charAt(0).toUpperCase()+derived.slice(1);
        const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{display_name:displayName}}});
        if(error)throw error;
        if(!data.session){feedback.textContent='Cuenta creada. Revisa tu correo para confirmar la dirección antes de entrar.';feedback.className='auth-feedback success';return}
        closeAuthModal();
      }else{
        const {error}=await supabaseClient.auth.signInWithPassword({email,password});
        if(error)throw error;
        closeAuthModal();
      }
    }catch(err){feedback.textContent=err?.message||'No se pudo completar el acceso.';feedback.className='auth-feedback error'}
    finally{submit.disabled=false}
  });
}

initUserAccount();
initBackend();
