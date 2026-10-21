
/* CardDex beta — galería visual de Mi colección. Solo metadatos públicos en caché. */
(() => {
  'use strict';
  const $owned = selector => document.querySelector(selector);
  const STORAGE = 'carddex_owned_visual_cache_v1';
  const PAGE_SIZE = 60;
  const cache = new Map();
  let currentSignature = '';
  let currentGeneration = 0;
  let totalToHydrate = 0;
  let loadedDuringHydration = 0;
  let hydrationBusy = false;
  let metadataBusy = false;
  let fullInfoPromise = null;
  let cachedSaveTimer = null;
  let renderTimer = null;
  let pageLimit = PAGE_SIZE;
  let layout = 'cards';
  let lastResultCards = [];
  let ownedList = [];

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    Object.entries(saved).forEach(([id,data]) => {
      if (data && typeof data === 'object' && data.name) cache.set(id, data);
    });
  } catch (error) { console.warn('CardDex caché visual:', error); }

  function normalize(value) {
    return typeof normalizeText === 'function' ? normalizeText(value)
      : String(value || '').toLowerCase().trim();
  }
  function esc(value) {
    return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value || '');
  }
  function setIdFor(cardId) {
    const text = String(cardId || '');
    return text.slice(0, text.lastIndexOf('-')) || text;
  }
  function physicalOnly(id) {
    return !/^(?:tcgp|[ab][0-9]+[a-z]?|p-a)(?:-|$)/i.test(String(id));
  }
  function readOwned() {
    return Object.entries(collection || {})
      .filter(([id,quantity]) => Number(quantity) > 0 && physicalOnly(id))
      .map(([id,quantity]) => ({id, quantity:Number(quantity)}));
  }
  function saveVisualCacheSoon() {
    clearTimeout(cachedSaveTimer);
    cachedSaveTimer = setTimeout(() => {
      try {
        const entries = [...cache.entries()].filter(([,v]) => v?.name && v.name !== 'Carta').slice(-1800);
        localStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries(entries)));
      } catch(error) { console.warn('CardDex caché completa:', error); }
    },1200);
  }
  function remember(card, full=false) {
    if (!card?.id) return false;
    const prev = cache.get(card.id) || {};
    const sourceSet = typeof getSetById === 'function' ? getSetById(setIdFor(card.id)) : null;
    const next = {
      id:card.id,
      name:card.name || prev.name || card.id,
      localId:card.localId || prev.localId || card.id.split('-').pop(),
      image:card.image || prev.image || '',
      setId:setIdFor(card.id),
      setName:card.setName || card.set?.name || sourceSet?.name || prev.setName || '',
      rarity:card.rarity || prev.rarity || '',
      types:Array.isArray(card.types) ? card.types : (prev.types || []),
      category:card.category || prev.category || '',
      full: Boolean(full || prev.full)
    };
    if (JSON.stringify(prev)===JSON.stringify(next)) return false;
    cache.set(card.id,next);
    saveVisualCacheSoon();
    return true;
  }
  function seedFromExisting() {
    [currentSetCards, currentVisibleCards].forEach(list => {
      if (Array.isArray(list)) list.forEach(card=>{if(card?.id && card?.name)remember(card)});
    });
    if(typeof cardDetailCache !== 'undefined'){
      cardDetailCache.forEach(data=>remember(data,true));
    }
    Object.values(wishlist||{}).forEach(card=>remember(card));
    (goals||[]).forEach(goal=>(goal.cards||[]).forEach(card=>remember(card)));
  }
  function hydrateOne(id) {
    return getCardDetail(id).then(data => remember(data,true)).catch(error=>{
      console.warn('CardDex ficha visual:',id,error?.message||error);
      return false;
    });
  }
  async function fetchSetBrief(setId, ids, generation) {
    const known = typeof getSetById==='function' ? getSetById(setId) : null;
    const langs = [...new Set([known?.lang,'es','en'].filter(Boolean))];
    let briefs=[];
    for(const lang of langs){
      try{
        const json=await fetchJson(apiFor(lang)+'/sets/'+encodeURIComponent(setId));
        if(Array.isArray(json?.cards)&&json.cards.length){briefs=json.cards;break}
      }catch(error){}
    }
    if(generation!==currentGeneration) return;
    const lookup=new Map(briefs.map(card=>[card.id,card]));
    const missing=[];
    ids.forEach(id=>{
      const card=lookup.get(id);
      if(card)remember({...card, setName:known?.name||''});
      else missing.push(id);
      loadedDuringHydration++;
    });
    scheduleRender();
    // Algunas cartas promocionales no aparecen en el listado del set.
    for(const id of missing){
      if(generation!==currentGeneration)return;
      await hydrateOne(id);
      scheduleRender();
    }
  }
  function hydrateOwnedCards(){
    if(hydrationBusy || !ownedList.length)return;
    const needed=ownedList.filter(item=>!cache.get(item.id)?.name || cache.get(item.id)?.name===item.id);
    if(!needed.length){totalToHydrate=0;loadedDuringHydration=0;scheduleRender();return;}
    hydrationBusy=true;
    const generation=currentGeneration;
    totalToHydrate=needed.length;
    loadedDuringHydration=0;
    const bySet=new Map();
    needed.forEach(({id})=>{
      const setId=setIdFor(id);
      if(!bySet.has(setId))bySet.set(setId,[]);
      bySet.get(setId).push(id);
    });
    const groups=[...bySet.entries()];
    let cursor=0;
    const worker=async()=>{
      while(cursor<groups.length && generation===currentGeneration){
        const [setId,ids]=groups[cursor++];
        await fetchSetBrief(setId,ids,generation);
      }
    };
    Promise.all(Array.from({length:Math.min(5,groups.length)},worker)).finally(()=>{
      if(generation===currentGeneration){
        hydrationBusy=false;
        scheduleRender();
      }
    });
  }
  function metadataRequired(){
    return Boolean($owned('#ownedRarityFilter')?.value || $owned('#ownedCategoryFilter')?.value || $owned('#ownedTypeFilter')?.value);
  }
  function enrichForFilters(){
    if(fullInfoPromise)return fullInfoPromise;
    const generation=currentGeneration;
    const pending=ownedList.filter(({id})=>!cache.get(id)?.full).map(item=>item.id);
    if(!pending.length){metadataBusy=false;render();return Promise.resolve();}
    metadataBusy=true;
    let cursor=0,completed=0;
    fullInfoPromise=Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
      while(cursor<pending.length && generation===currentGeneration){
        const id=pending[cursor++];
        await hydrateOne(id);
        completed++;
        if(completed%8===0)scheduleRender();
      }
    })).finally(()=>{
      if(generation===currentGeneration){metadataBusy=false;scheduleRender();}
      fullInfoPromise=null;
    });
    return fullInfoPromise;
  }
  function updateSetChoices(){
    const select=$owned('#ownedSetFilter');
    if(!select)return;
    const before=select.value;
    const distinct=[...new Set(ownedList.map(entry=>setIdFor(entry.id)))];
    distinct.sort((a,b)=>{
      const ai=sets.findIndex(s=>s.tcgId===a),bi=sets.findIndex(s=>s.tcgId===b);
      return (ai<0?99999:ai)-(bi<0?99999:bi) || a.localeCompare(b);
    });
    select.innerHTML='<option value="">Todas las expansiones</option>'+distinct.map(id=>{
      const set=typeof getSetById==='function'?getSetById(id):null;
      const label=set?.name||cache.get(ownedList.find(item=>setIdFor(item.id)===id)?.id)?.setName||id;
      return '<option value="'+esc(id)+'">'+esc(label)+'</option>';
    }).join('');
    select.value=distinct.includes(before)?before:'';
  }
  function initializeFilterChoices(){
    const rarity=$owned('#ownedRarityFilter');
    const type=$owned('#ownedTypeFilter');
    if(rarity && rarity.options.length===1){
      const rareLabels=typeof RARITY_META!=='undefined' ? RARITY_META : {};
      Object.entries(rareLabels).forEach(([id,meta])=>rarity.add(new Option(meta.label||id,id)));
      rarity.add(new Option('Sin rareza','None'));
    }
    if(type && type.options.length===1){
      const types=typeof TYPE_META!=='undefined'?TYPE_META:{};
      Object.entries(types).forEach(([id,meta])=>type.add(new Option(meta.label||id,id)));
    }
  }
  function matchesFilters(item,search){
    const card=cache.get(item.id) || {name:item.id};
    if(search && !normalize([card.name,card.localId,card.setName,item.id].join(' ')).includes(search))return false;
    const set=$owned('#ownedSetFilter')?.value;
    if(set && setIdFor(item.id)!==set)return false;
    if($owned('#ownedDuplicatesFilter')?.checked && item.quantity<2)return false;
    const category=$owned('#ownedCategoryFilter')?.value;
    const rarity=$owned('#ownedRarityFilter')?.value;
    const type=$owned('#ownedTypeFilter')?.value;
    if(category && card.category!==category)return false;
    if(rarity && card.rarity!==rarity)return false;
    if(type && !(card.types||[]).includes(type))return false;
    return true;
  }
  function sortedResults(items){
    const sort=$owned('#ownedSortFilter')?.value||'set';
    const setOrder=new Map(sets.map((s,i)=>[s.tcgId,i]));
    items.sort((a,b)=>{
      const ca=cache.get(a.id)||{}, cb=cache.get(b.id)||{};
      if(sort==='name')return String(ca.name||a.id).localeCompare(String(cb.name||b.id),'es');
      if(sort==='quantity')return b.quantity-a.quantity || a.id.localeCompare(b.id);
      if(sort==='number')return Number(ca.localId||99999)-Number(cb.localId||99999) || a.id.localeCompare(b.id);
      return (setOrder.get(setIdFor(a.id))??99999)-(setOrder.get(setIdFor(b.id))??99999)
        || Number(ca.localId||99999)-Number(cb.localId||99999) || a.id.localeCompare(b.id);
    });
    return items;
  }
  function render(){
    const grid=$owned('#ownedCardsGrid');if(!grid)return;
    const duplicates=ownedList.filter(item=>item.quantity>1).length;
    $owned('#ownedUniqueCount').textContent=ownedList.length.toLocaleString('es-ES');
    $owned('#ownedTotalCount').textContent=ownedList.reduce((n,item)=>n+item.quantity,0).toLocaleString('es-ES');
    $owned('#ownedDuplicateCount').textContent=duplicates.toLocaleString('es-ES');
    const status=$owned('#ownedCollectionProgress');
    if(backendConfigured() && remoteUser && !remoteDataReady){
      status.textContent='Sincronizando tus cartas con tu cuenta…';
      grid.innerHTML='<div class="empty">Recuperando la colección de Supabase…</div>';
      return;
    }
    if(!ownedList.length){
      status.textContent='';
      grid.innerHTML='<div class="empty">Aún no tienes cartas registradas. Visita Expansiones o el Buscador, abre una carta y pulsa + para añadirla aquí.</div>';
      $owned('#ownedCardsResultCount').textContent='';
      $owned('#ownedCardsShowMore').hidden=true;
      return;
    }
    const search=normalize($owned('#ownedCardsSearch')?.value);
    const filtered=sortedResults(ownedList.filter(item=>matchesFilters(item,search)));
    const shown=filtered.slice(0,pageLimit);
    lastResultCards=filtered.map(item=>cache.get(item.id)||{id:item.id,name:item.id,localId:item.id.split('-').pop()});
    const loadingMetadata=metadataRequired() && metadataBusy;
    if(loadingMetadata){
      grid.innerHTML='<div class="empty">Analizando rarezas, tipos y categorías de tus cartas…</div>';
    }else{
      grid.innerHTML=shown.map(({id,quantity})=>{
        const data=cache.get(id)||{id,name:'Carta '+id,localId:id.split('-').pop(),image:''};
        let markup=cardTile(data);
        if(quantity>1)markup=markup.replace('class="tcg-card ','class="tcg-card duplicate ');
        return markup;
      }).join('') || '<div class="empty">No tienes cartas que coincidan con esos filtros.</div>';
    }
    $owned('#ownedCardsResultCount').textContent=filtered.length.toLocaleString('es-ES')+' cartas encontradas';
    const more=$owned('#ownedCardsShowMore');
    more.hidden=loadingMetadata||filtered.length<=pageLimit;
    more.textContent='Mostrar más cartas ('+(filtered.length-pageLimit).toLocaleString('es-ES')+' pendientes)';
    if(loadingMetadata) status.textContent='Preparando filtros completos desde TCGdex…';
    else if(hydrationBusy)status.textContent='Preparando imágenes y nombres · '+loadedDuringHydration+' / '+totalToHydrate+' cartas';
    else status.textContent=filtered.length+' de '+ownedList.length+' cartas diferentes'+(layout==='sets'?' · Vista por expansiones':'');
    grid.querySelectorAll('.tcg-card[data-card-id]').forEach(el=>el.addEventListener('click',()=>{
      currentSet=null;currentPokemon=null;currentSetCards=[];
      currentVisibleCards=lastResultCards;
      openCard(el.dataset.cardId);
    }));
  }
  function scheduleRender(){
    if(renderTimer)return;
    renderTimer=setTimeout(()=>{renderTimer=null;render()},90);
  }
  function refresh(force=false){
    seedFromExisting();
    const next=readOwned();
    const signature=next.map(x=>x.id).sort().join('|');
    const changed=signature!==currentSignature;
    ownedList=next;
    if(changed){
      currentSignature=signature;
      currentGeneration++;
      hydrationBusy=false;
      fullInfoPromise=null;
      metadataBusy=false;
      pageLimit=PAGE_SIZE;
    }
    updateSetChoices();
    render();
    if(changed || force)hydrateOwnedCards();
    if(metadataRequired()&&!metadataBusy&&!fullInfoPromise)enrichForFilters();
  }
  function activate(){
    if(!$owned('#mycollection')?.classList.contains('active-view'))return;
    if($owned('#collectionTabCards')?.hidden)return;
    refresh();
  }
  function switchLayout(next){
    layout=next==='sets'?'sets':'cards';
    $owned('#ownedCardsView').hidden=layout!=='cards';
    $owned('#ownedSetsView').hidden=layout!=='sets';
    document.querySelectorAll('[data-owned-view]').forEach(btn=>{
      const selected=btn.dataset.ownedView===layout;
      btn.classList.toggle('active',selected);
      btn.setAttribute('aria-pressed',String(selected));
    });
    $owned('#ownedCardsSearch').disabled=layout==='sets';
    $owned('#ownedFiltersToggle').disabled=layout==='sets';
    $owned('#ownedFiltersPanel').hidden=layout==='sets' || !$owned('#ownedFiltersToggle').classList.contains('active');
    if(layout==='sets')renderMyCollectionSets();
    else refresh();
  }
  function init(){
    initializeFilterChoices();
    const search=$owned('#ownedCardsSearch');
    search?.addEventListener('input',()=>{
      pageLimit=PAGE_SIZE;
      scheduleRender();
    });
    document.querySelectorAll('[data-owned-view]').forEach(btn=>btn.addEventListener('click',()=>switchLayout(btn.dataset.ownedView)));
    $owned('#ownedFiltersToggle')?.addEventListener('click',event=>{
      const btn=event.currentTarget;
      const isExpanded=!btn.classList.contains('active');
      btn.classList.toggle('active',isExpanded);
      btn.setAttribute('aria-expanded',String(isExpanded));
      $owned('#ownedFiltersPanel').hidden=!isExpanded;
    });
    ['#ownedSetFilter','#ownedSortFilter','#ownedDuplicatesFilter'].forEach(id=>{
      $owned(id)?.addEventListener('change',()=>{pageLimit=PAGE_SIZE;render()});
    });
    ['#ownedRarityFilter','#ownedCategoryFilter','#ownedTypeFilter'].forEach(id=>{
      $owned(id)?.addEventListener('change',()=>{
        pageLimit=PAGE_SIZE;
        if(metadataRequired())enrichForFilters();
        else render();
      });
    });
    $owned('#ownedClearFilters')?.addEventListener('click',()=>{
      ['#ownedSetFilter','#ownedCategoryFilter','#ownedRarityFilter','#ownedTypeFilter'].forEach(id=>$owned(id).value='');
      $owned('#ownedSortFilter').value='set';
      $owned('#ownedDuplicatesFilter').checked=false;
      $owned('#ownedCardsSearch').value='';
      pageLimit=PAGE_SIZE;
      render();
    });
    $owned('#ownedCardsShowMore')?.addEventListener('click',()=>{
      pageLimit+=PAGE_SIZE;render();
    });
    refresh();
  }
  window.CardDexOwned={refresh,activate,switchLayout};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
