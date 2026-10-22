/* CardDex beta: galería visual independiente. No modifica cuentas, colección ni Supabase. */
(() => {
  'use strict';
  const PAGE=60, KEY='carddex_gallery_meta_v2';
  const PRICE_KEY='carddex_gallery_prices_v1', PRICE_TTL=24*60*60*1000, ERROR_TTL=15*60*1000;
  const formatEur=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});
  const $=s=>document.querySelector(s);
  const cache=new Map();
  const failed=new Set();
  const prices=new Map();
  let priceLoading=false, priceDone=0, priceTotal=0, hitsMode='all';
  let version='', visible=PAGE, view='cards', loading=false, detailLoading=false, sequence=0, loaded=0, pending=0;
  let entries=[], matched=[];
  try { Object.entries(JSON.parse(localStorage.getItem(KEY)||'{}')).forEach(([k,v])=>{if(v?.name)cache.set(k,v)}); } catch {}
  try { Object.entries(JSON.parse(localStorage.getItem(PRICE_KEY)||'{}')).forEach(([k,v])=>{
    if(v&&typeof v.checkedAt==='number'&&(v.price===null||typeof v.price==='number'))prices.set(k,v);
  }); } catch {}
  let priceSaveTimer=0;
  const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const html=v=>escapeHtml(String(v??''));
  const setOf=id=>String(id).split('-').slice(0,-1).join('-');
  const pocket=id=>/^(?:tcgp|[ab]\d+[a-z]?|p-a)(?:-|$)/i.test(id);
  const labelSet=id=>getSetById(id)?.name||id;
  function saveCache(){
    try{localStorage.setItem(KEY,JSON.stringify(Object.fromEntries([...cache.entries()].slice(-1600))))}catch{}
  }
  function savePricesSoon(){
    clearTimeout(priceSaveTimer);
    priceSaveTimer=setTimeout(()=>{
      try { localStorage.setItem(PRICE_KEY,JSON.stringify(Object.fromEntries([...prices].slice(-3500)))); }
      catch(error){console.warn('CardDex precios: caché no disponible',error);}
    },700);
  }
  function positivePrice(value){return typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;}
  function marketPrice(market){
    if(!market||market.unit&&market.unit!=='EUR')return null;
    // La colección no distingue acabado normal, holo o reverso. Priorizamos el precio base.
    for(const suffix of ['', '-holo']){
      for(const key of ['trend','avg','avg7','avg30','low']){
        const value=positivePrice(market[key+suffix]);
        if(value!==null)return value;
      }
    }
    return null;
  }
  function readCardPrice(data){
    const main=marketPrice(data?.pricing?.cardmarket);
    if(main!==null)return main;
    // En algunos sets Cardmarket solo ofrece precio de variantes concretas.
    const variants=Array.isArray(data?.variants_detailed)?data.variants_detailed:[];
    const defaultVariant=variants.find(v=>v?.variantId==='generated' || v?.type==='normal')||variants[0];
    return marketPrice(defaultVariant?.pricing?.cardmarket);
  }
  function isHit(card){
    const rarity=String(card?.rarity||'').toLowerCase();
    const name=String(card?.name||'');
    if(/(?:^|\b)(?:double rare|illustration rare|special illustration rare|ultra rare|hyper rare|secret rare|rainbow rare|amazing rare|radiant rare|shiny rare|ace spec rare|rare holo ex|rare holo gx|rare holo v|rare holo vmax|rare holo vstar|rare holo lv\.x|rare prime|rare break|rare prism|rare shiny)(?:$|\b)/i.test(rarity))return true;
    return /(?:^|\s)(?:ex|GX|V|VMAX|VSTAR|BREAK|TURBO|LV\.X)(?=$|\s|[-/])/i.test(name);
  }
  // A diferencia del filtro EX/ex, aquí la rareza debe ser especial: el nombre
  // Charizard ex no basta para contar como HIT premium si es una Double Rare.
  function isPremiumHit(card){
    const rarity=String(card?.rarity||'').trim().toLowerCase();
    if(!rarity||/^(?:none|common|uncommon|rare|rare holo|holo rare|double rare|promo|promotional|rare holo ex|rare holo gx|rare holo v|rare holo vmax|rare holo vstar)$/i.test(rarity))return false;
    return /(?:illustration rare|ultra rare|hyper rare|secret rare|rainbow rare|shiny rare|rare shiny|rare ultra|rare secret|rare rainbow|gold rare|amazing rare|radiant rare|rare radiant|ace spec rare|rare ace|special art|alternate art|full art|trainer gallery|galarian gallery|prism star|rare prism|rare prime|rare break|rare holo lv\.x|rare holo legend|rare holo star|rare holo gold star|rare holo break|rare holo prime)/i.test(rarity);
  }
  function setHitsMode(mode){
    hitsMode=hitsMode===mode?'all':mode;
    [['galleryHitsOnly','ex'],['galleryPremiumOnly','premium']].forEach(([id,value])=>{
      const btn=$('#'+id);
      if(!btn)return;
      const active=hitsMode===value;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',String(active));
    });
    visible=PAGE;render();maybeDetail();
  }
  function priced(value){
    const data=prices.get(value);
    return data&&data.price!==null&&Number.isFinite(data.price)&&data.price>0?data.price:null;
  }
  function hasActiveFilters(){
    return Boolean(hitsMode!=='all'||$('#gallerySearch').value.trim()||$('#gallerySet').value||
      $('#galleryRarity').value||$('#galleryType').value||$('#galleryCategory').value||$('#galleryDupOnly').checked);
  }
  function renderValue(items){
    const title=$('#galleryValueTitle'),amount=$('#galleryValueAmount');
    if(!title||!amount)return;
    title.textContent=hasActiveFilters()&&view==='cards'?'Valor estimado de las cartas filtradas':'Valor total estimado';
    let total=0,valued=0,without=0,pendingCount=0,failedCount=0;
    for(const {id,quantity} of items){
      const found=prices.get(id),price=priced(id);
      if(price!==null){total+=price*quantity;valued++;}
      else if(!found || Date.now()-found.checkedAt>(found.error?ERROR_TTL:PRICE_TTL))pendingCount++;
      else if(found.error)failedCount++;
      else without++;
    }
    const classificationPending=view==='cards' && advanced() &&
      entries.some(item=>!cache.get(item.id)?.full);
    amount.textContent=classificationPending&&(priceLoading||detailLoading)?'Clasificando…':
      items.length===0?formatEur.format(0):
      valued?formatEur.format(total):pendingCount&&priceLoading?'Calculando…':'Sin valoración';
    const coverage=$('#galleryValueCoverage');
    coverage.textContent=valued+' de '+items.length+' cartas con precio'
      +(without?' · '+without+' sin precio':'')
      +(pendingCount?' · '+pendingCount+' pendientes':'')
      +(failedCount?' · '+failedCount+' con error':'');
    const state=$('#galleryValueProgress');
    state.textContent=classificationPending&&(priceLoading||detailLoading)?'Identificando tipos y rarezas…':
      priceLoading?'Consultando Cardmarket: '+priceDone+' / '+priceTotal:
      pendingCount?'Valoración todavía incompleta':'Precios orientativos de Cardmarket';
    const refreshButton=$('#galleryReprice');
    if(refreshButton)refreshButton.disabled=priceLoading;
  }
  async function readFreshPrice(cardId){
    try{
      // Una cotización caducada debe volver a la API, no al Map de esta misma sesión.
      const previous=prices.get(cardId);
      if(previous && Date.now()-previous.checkedAt>PRICE_TTL && typeof cardDetailCache!=='undefined')
        cardDetailCache.delete(cardId);
      const full=await getCardDetail(cardId);
      addMeta(full,true);
      let price=readCardPrice(full);
      if(price===null && typeof enrichCardmarketPricing==='function'){
        const en=await enrichCardmarketPricing(cardId,full);
        price=readCardPrice(en);
      }
      prices.set(cardId,{price,checkedAt:Date.now(),error:false});
    }catch(error){
      // No confundir errores de red o API con una carta cuyo precio no existe.
      prices.set(cardId,{price:null,checkedAt:Date.now(),error:true});
      console.warn('CardDex precio no disponible',cardId,error?.message||error);
    }
    savePricesSoon();
  }
  async function updatePrices(){
    if(priceLoading||!isCurrent()||!entries.length)return;
    const generation=sequence,now=Date.now();
    const prioritized=[...new Set([...filteredPriceEntries.map(item=>item.id),...entries.map(item=>item.id)])];
    const todo=prioritized.filter(id=>{
      const saved=prices.get(id);
      return !saved||now-saved.checkedAt>(saved.error?ERROR_TTL:PRICE_TTL);
    });
    if(!todo.length){renderValue(view==='cards'?filteredPriceEntries:entries);return;}
    priceLoading=true;priceDone=0;priceTotal=todo.length;
    let index=0;
    const workers=Array.from({length:Math.min(3,todo.length)},async()=>{
      while(index<todo.length && generation===sequence){
        const id=todo[index++];
        await readFreshPrice(id);
        priceDone++;
        if(priceDone%5===0||priceDone===todo.length){
          if(view==='cards'&&advanced())render(); // Mostrar nuevos HITs al clasificarlos.
          else renderValue(view==='cards'?filteredPriceEntries:entries);
        }
      }
    });
    await Promise.all(workers);
    if(generation===sequence){
      priceLoading=false;
      saveCache();
      options();
      render();
    }
  }
  let filteredPriceEntries=[];
  function addMeta(data, full=false){
    if(!data?.id||!data?.name)return;
    const before=cache.get(data.id)||{};
    cache.set(data.id,{
      ...before,id:data.id,name:data.name,localId:data.localId||before.localId||data.id.split('-').at(-1),
      image:data.image||before.image||'',setId:setOf(data.id),
      category:data.category||before.category||'',rarity:data.rarity||before.rarity||'',
      types:data.types||before.types||[], full:full||before.full||false
    });
  }
  function seed(){
    [currentSetCards,currentVisibleCards].forEach(arr=>arr?.forEach(item=>addMeta(item)));
    if(typeof cardDetailCache!=='undefined')cardDetailCache.forEach(v=>addMeta(v,true));
  }
  function owned(){
    return Object.entries(collection||{}).filter(([id,q])=>!pocket(id)&&Number(q)>0)
      .map(([id,q])=>({id,quantity:Number(q)}));
  }
  function ui(){
    const parent=$('#collectionTabSets');
    if(!parent||$('#ownedGallery'))return;
    parent.insertAdjacentHTML('afterbegin',`<div id="ownedGallery">
      <div class="gallery-stats"><div><small>Cartas distintas</small><strong id="galleryUnique">0</strong></div><div><small>Ejemplares</small><strong id="galleryCopies">0</strong></div><div><small>Con repetidas</small><strong id="galleryDups">0</strong></div></div>
      <section class="gallery-valuation" aria-label="Valoración de la colección">
        <div class="gallery-valuation-main">
          <div><small id="galleryValueTitle">Valor total estimado</small><strong id="galleryValueAmount">Calculando…</strong></div>
          <span class="gallery-valuation-icon" aria-hidden="true">€</span>
        </div>
        <div id="galleryValueCoverage" class="gallery-value-coverage">Preparando valoración…</div>
        <div class="gallery-value-bottom"><small id="galleryValueProgress" aria-live="polite">Precios orientativos de Cardmarket</small>
          <button id="galleryReprice" type="button" title="Volver a consultar los precios disponibles">Actualizar precios</button></div>
        <small class="gallery-value-disclaimer">Importes aproximados: pueden variar por idioma, conservación y acabado (normal, holo o reverso). Las cartas sin precio no se suman.</small>
      </section>
      <div class="gallery-toolbar"><input id="gallerySearch" type="search" placeholder="Buscar entre mis cartas…" aria-label="Buscar entre mis cartas">
        <button class="gallery-view active" data-gallery-view="cards" type="button">▦ Cartas</button>
        <button class="gallery-view" data-gallery-view="sets" type="button">▤ Expansiones</button>
        <button id="galleryHitsOnly" type="button" aria-pressed="false" title="Incluye EX/ex, GX, V y rarezas superiores">✦ EX/ex y superiores</button>
        <button id="galleryPremiumOnly" type="button" aria-pressed="false" title="Solo rarezas especiales (ilustraciones raras, full arts, secretas, etc.). Excluye las EX/ex normales y Double Rare.">✧ HITs especiales</button>
        <button id="galleryToggle" type="button" aria-expanded="false">☷ Filtros</button></div>
      <div id="galleryFilters" class="gallery-filters" hidden>
        <label>Expansión<select id="gallerySet"><option value="">Todas</option></select></label>
        <label>Rareza<select id="galleryRarity"><option value="">Todas</option></select></label>
        <label>Tipo<select id="galleryType"><option value="">Todos</option></select></label>
        <label>Categoría<select id="galleryCategory"><option value="">Todas</option><option value="Pokemon">Pokémon</option><option value="Trainer">Entrenador</option><option value="Energy">Energía</option></select></label>
        <label>Orden<select id="gallerySort"><option value="set">Expansión reciente</option><option value="name">Nombre A–Z</option><option value="quantity">Más ejemplares</option><option value="number">Número</option></select></label>
        <label class="gallery-check"><input id="galleryDupOnly" type="checkbox"> Solo repetidas</label>
        <button id="galleryClear" type="button">Limpiar</button>
      </div>
      <p id="galleryStatus" aria-live="polite"></p>
      <div id="galleryCards" class="tcg-grid gallery-cards"></div>
      <div class="gallery-pager"><span id="galleryTotal"></span><button id="galleryMore" type="button" hidden>Mostrar más</button></div>
    </div>`);
    $('#gallerySearch').addEventListener('input',()=>{visible=PAGE;render()});
    $('#galleryHitsOnly').addEventListener('click',()=>setHitsMode('ex'));
    $('#galleryPremiumOnly').addEventListener('click',()=>setHitsMode('premium'));
    $('#galleryReprice').addEventListener('click',()=>{
      if(priceLoading)return;
      prices.clear();
      // El botón fuerza una consulta real; no vuelve a usar fichas antiguas en memoria.
      if(typeof cardDetailCache!=='undefined')entries.forEach(item=>cardDetailCache.delete(item.id));
      savePricesSoon();render();updatePrices();
    });
    $('#galleryToggle').addEventListener('click',()=>{const e=$('#galleryFilters');e.hidden=!e.hidden;$('#galleryToggle').setAttribute('aria-expanded',String(!e.hidden))});
    document.querySelectorAll('[data-gallery-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.galleryView)));
    ['gallerySet','galleryRarity','galleryType','galleryCategory','gallerySort','galleryDupOnly'].forEach(id=>$('#'+id).addEventListener('change',()=>{visible=PAGE;render();maybeDetail()}));
    $('#galleryClear').addEventListener('click',()=>{
      ['gallerySet','galleryRarity','galleryType','galleryCategory'].forEach(id=>$('#'+id).value='');
      $('#gallerySort').value='set';$('#galleryDupOnly').checked=false;$('#gallerySearch').value='';
      hitsMode='all';
      ['galleryHitsOnly','galleryPremiumOnly'].forEach(id=>{
        $('#'+id).classList.remove('active');$('#'+id).setAttribute('aria-pressed','false');
      });
      visible=PAGE;render();
    });
    $('#galleryMore').addEventListener('click',()=>{visible+=PAGE;render();hydrate()});
    switchView('cards');
  }
  function switchView(which){
    view=which==='sets'?'sets':'cards';
    document.querySelectorAll('[data-gallery-view]').forEach(b=>b.classList.toggle('active',b.dataset.galleryView===view));
    $('#galleryCards').hidden=view==='sets';$('#galleryStatus').hidden=view==='sets';
    $('.gallery-pager').hidden=view==='sets';$('#myCollectionSets').hidden=view!=='sets';
    $('#galleryFilters').hidden=view==='sets'||$('#galleryToggle').getAttribute('aria-expanded')!=='true';
    $('#gallerySearch').disabled=view==='sets';$('#galleryToggle').disabled=view==='sets';
    $('#galleryHitsOnly').disabled=view==='sets';
    $('#galleryPremiumOnly').disabled=view==='sets';
    if(view==='cards')refresh();else render();
  }
  function isCurrent(){return $('#mycollection')?.classList.contains('active-view')&&!$('#collectionTabSets').hidden&&view==='cards'}
  function options(){
    const setIds=[...new Set(entries.map(x=>setOf(x.id)))];
    const s=$('#gallerySet'),old=s.value;
    s.innerHTML='<option value="">Todas las expansiones</option>'+setIds.map(id=>`<option value="${html(id)}">${html(labelSet(id))}</option>`).join('');
    s.value=setIds.includes(old)?old:'';
    [['galleryRarity','RARITY'],['galleryType','TYPE']].forEach(([selectName,which])=>{
      const select=$('#'+selectName), previous=select.value;
      const names=which==='RARITY'?RARITY_META:TYPE_META;
      const vals=new Set([...Object.keys(names||{}),...entries.flatMap(x=>{
        const m=cache.get(x.id)||{};const v=which==='RARITY'?m.rarity:m.types;return Array.isArray(v)?v:[v];
      })].filter(Boolean));
      select.innerHTML=`<option value="">${which==='RARITY'?'Todas las rarezas':'Todos los tipos'}</option>`+[...vals].map(v=>`<option value="${html(v)}">${html(names?.[v]?.label||v)}</option>`).join('');
      select.value=vals.has(previous)?previous:'';
    });
  }
  function advanced(){return Boolean(hitsMode!=='all'||$('#galleryRarity').value||$('#galleryType').value||$('#galleryCategory').value)}
  function render(){
    if(!$('#ownedGallery'))return;
    $('#galleryUnique').textContent=entries.length;
    $('#galleryCopies').textContent=entries.reduce((sum,item)=>sum+item.quantity,0);
    $('#galleryDups').textContent=entries.filter(x=>x.quantity>1).length;
    if(view!=='cards'){filteredPriceEntries=entries;renderValue(entries);return;}
    const search=clean($('#gallerySearch').value);
    const set=$('#gallerySet').value,rare=$('#galleryRarity').value,type=$('#galleryType').value,cat=$('#galleryCategory').value;
    const dup=$('#galleryDupOnly').checked;
    const order=new Map(sets.map((s,i)=>[s.tcgId,i]));
    const results=entries.filter(item=>{
      const card=cache.get(item.id)||{};
      if(dup&&item.quantity<2)return false;
      if(set&&set!==setOf(item.id))return false;
      if(search&&!clean([card.name,item.id,card.localId,labelSet(setOf(item.id))].join(' ')).includes(search))return false;
      if(rare&&card.rarity!==rare)return false;
      if(type&&!(card.types||[]).includes(type))return false;
      if(cat&&card.category!==cat)return false;
      if(hitsMode==='ex'&&!isHit(card))return false;
      if(hitsMode==='premium'&&!isPremiumHit(card))return false;
      return true;
    });
    const sort=$('#gallerySort').value;
    results.sort((a,b)=>{
      if(sort==='quantity')return b.quantity-a.quantity||a.id.localeCompare(b.id);
      if(sort==='name')return (cache.get(a.id)?.name||a.id).localeCompare(cache.get(b.id)?.name||b.id,'es');
      if(sort==='number')return Number(cache.get(a.id)?.localId||9999)-Number(cache.get(b.id)?.localId||9999)||a.id.localeCompare(b.id);
      return (order.get(setOf(a.id))??99999)-(order.get(setOf(b.id))??99999)||a.id.localeCompare(b.id);
    });
    filteredPriceEntries=results;
    matched=results.map(({id})=>cache.get(id)||{id,name:'Carta '+id,localId:id.split('-').at(-1),image:''});
    renderValue(results);
    $('#galleryCards').innerHTML=results.slice(0,visible).map(({id,quantity})=>{
      const card=cache.get(id)||{id,name:'Carta '+id,localId:id.split('-').at(-1),image:''};
      return cardTile(card).replace('class="tcg-card ',`class="tcg-card ${quantity>1?'gallery-duplicate ':''}`);
    }).join('')||`<div class="empty">${entries.length?'No hay cartas que coincidan con los filtros.':'Todavía no tienes cartas registradas. Añádelas desde Expansiones o el Buscador.'}</div>`;
    $('#galleryTotal').textContent=results.length+' cartas';
    $('#galleryMore').hidden=results.length<=visible;
    $('#galleryStatus').textContent=loading?`Preparando imágenes: ${loaded} de ${pending}`:detailLoading?'Completando datos de rarezas y tipos…':'';
    $('#galleryCards').querySelectorAll('.tcg-card[data-card-id]').forEach(el=>el.addEventListener('click',()=>{
      currentSet=null;currentPokemon=null;currentSetCards=[];currentVisibleCards=matched;
      openCard(el.dataset.cardId);
    }));
  }
  async function hydrate(){
    if(loading||!isCurrent())return;
    const todo=entries.filter(x=>!cache.has(x.id)&&!failed.has(x.id)).slice(0,Math.max(visible,120));
    if(!todo.length)return;
    loading=true;const gen=sequence;pending=todo.length;loaded=0;
    const buckets=new Map();todo.forEach(({id})=>{const setId=setOf(id);if(!buckets.has(setId))buckets.set(setId,[]);buckets.get(setId).push(id)});
    const groups=[...buckets],limit=3;let index=0;
    await Promise.all(Array.from({length:Math.min(limit,groups.length)},async()=>{
      while(index<groups.length&&sequence===gen){
        const [id,ids]=groups[index++];const lang=getSetById(id)?.lang||'es';let cards=[];
        for(const chosen of [...new Set([lang,'es','en'])]){
          try {const r=await fetchJson(apiFor(chosen)+'/sets/'+encodeURIComponent(id));if(r?.cards?.length){cards=r.cards;break}}catch{}
        }
        const map=new Map(cards.map(c=>[c.id,c]));
        for(const cardId of ids){
          if(sequence!==gen)break;
          let data=map.get(cardId);
          if(!data){try{data=await getCardDetail(cardId)}catch{}}
          if(data)addMeta(data,Boolean(data.category));
          else failed.add(cardId);
          loaded++;
        }
        if(sequence===gen){options();render();}
      }
    }));
    if(sequence===gen){
      loading=false;saveCache();render();
      if(entries.some(item=>!cache.has(item.id)&&!failed.has(item.id)))setTimeout(()=>hydrate(),150);
    }
  }
  async function maybeDetail(){
    if(!advanced()||detailLoading||priceLoading||!isCurrent())return;
    const list=entries.filter(x=>!cache.get(x.id)?.full).map(x=>x.id);
    if(!list.length)return;
    detailLoading=true;const gen=sequence;let index=0;
    await Promise.all(Array.from({length:Math.min(3,list.length)},async()=>{
      while(index<list.length&&gen===sequence){const id=list[index++];try{addMeta(await getCardDetail(id),true)}catch{}
        if(index%12===0&&gen===sequence){options();render();}
      }
    }));
    if(gen===sequence){detailLoading=false;saveCache();options();render();}
  }
  function refresh(){
    if(!$('#ownedGallery'))return;
    seed();const next=owned(),signature=next.map(x=>x.id).sort().join('|');
    if(signature!==version){version=signature;sequence++;loading=false;detailLoading=false;priceLoading=false;visible=PAGE;}
    entries=next;options();render();
    hydrate();updatePrices();maybeDetail();
  }
  function init(){
    ui();refresh();
    const area=$('#mycollection');
    new MutationObserver(()=>{if(isCurrent())refresh()}).observe(area,{attributes:true,attributeFilter:['class']});
    const tab=$('#collectionTabSets');
    new MutationObserver(()=>{if(isCurrent())refresh()}).observe(tab,{attributes:true,attributeFilter:['hidden']});
    // Las cantidades cambian en app.js a través de updateHomeStats, incluso al sincronizar.
    new MutationObserver(()=>{if(isCurrent())refresh()}).observe($('#homeTotalCopies'),{childList:true,characterData:true,subtree:true});
    const sync=$('#syncStatusBadge');if(sync)new MutationObserver(()=>{if(isCurrent())refresh()}).observe(sync,{childList:true,characterData:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
