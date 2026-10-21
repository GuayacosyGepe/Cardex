/* CardDex beta: galería visual independiente. No modifica cuentas, colección ni Supabase. */
(() => {
  'use strict';
  const PAGE=60, KEY='carddex_gallery_meta_v2';
  const $=s=>document.querySelector(s);
  const cache=new Map();
  let version='', visible=PAGE, view='cards', loading=false, detailLoading=false, sequence=0, loaded=0, pending=0;
  let entries=[], matched=[];
  try { Object.entries(JSON.parse(localStorage.getItem(KEY)||'{}')).forEach(([k,v])=>{if(v?.name)cache.set(k,v)}); } catch {}
  const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const html=v=>escapeHtml(String(v??''));
  const setOf=id=>String(id).split('-').slice(0,-1).join('-');
  const pocket=id=>/^(?:tcgp|[ab]\d+[a-z]?|p-a)(?:-|$)/i.test(id);
  const labelSet=id=>getSetById(id)?.name||id;
  function saveCache(){
    try{localStorage.setItem(KEY,JSON.stringify(Object.fromEntries([...cache.entries()].slice(-1600))))}catch{}
  }
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
      <div class="gallery-toolbar"><input id="gallerySearch" type="search" placeholder="Buscar entre mis cartas…" aria-label="Buscar entre mis cartas">
        <button class="gallery-view active" data-gallery-view="cards" type="button">▦ Cartas</button>
        <button class="gallery-view" data-gallery-view="sets" type="button">▤ Expansiones</button>
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
    $('#galleryToggle').addEventListener('click',()=>{const e=$('#galleryFilters');e.hidden=!e.hidden;$('#galleryToggle').setAttribute('aria-expanded',String(!e.hidden))});
    document.querySelectorAll('[data-gallery-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.galleryView)));
    ['gallerySet','galleryRarity','galleryType','galleryCategory','gallerySort','galleryDupOnly'].forEach(id=>$('#'+id).addEventListener('change',()=>{visible=PAGE;render();maybeDetail()}));
    $('#galleryClear').addEventListener('click',()=>{
      ['gallerySet','galleryRarity','galleryType','galleryCategory'].forEach(id=>$('#'+id).value='');
      $('#gallerySort').value='set';$('#galleryDupOnly').checked=false;$('#gallerySearch').value='';visible=PAGE;render();
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
    if(view==='cards')refresh();
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
  function advanced(){return Boolean($('#galleryRarity').value||$('#galleryType').value||$('#galleryCategory').value)}
  function render(){
    if(!$('#ownedGallery'))return;
    $('#galleryUnique').textContent=entries.length;
    $('#galleryCopies').textContent=entries.reduce((sum,item)=>sum+item.quantity,0);
    $('#galleryDups').textContent=entries.filter(x=>x.quantity>1).length;
    if(view!=='cards')return;
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
      return true;
    });
    const sort=$('#gallerySort').value;
    results.sort((a,b)=>{
      if(sort==='quantity')return b.quantity-a.quantity||a.id.localeCompare(b.id);
      if(sort==='name')return (cache.get(a.id)?.name||a.id).localeCompare(cache.get(b.id)?.name||b.id,'es');
      if(sort==='number')return Number(cache.get(a.id)?.localId||9999)-Number(cache.get(b.id)?.localId||9999)||a.id.localeCompare(b.id);
      return (order.get(setOf(a.id))??99999)-(order.get(setOf(b.id))??99999)||a.id.localeCompare(b.id);
    });
    matched=results.map(({id})=>cache.get(id)||{id,name:'Carta '+id,localId:id.split('-').at(-1),image:''});
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
    const todo=entries.filter(x=>!cache.has(x.id)).slice(0,Math.max(visible,120));
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
          loaded++;
        }
        if(sequence===gen){options();render();}
      }
    }));
    if(sequence===gen){loading=false;saveCache();render();}
  }
  async function maybeDetail(){
    if(!advanced()||detailLoading||!isCurrent())return;
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
    if(signature!==version){version=signature;sequence++;loading=false;detailLoading=false;visible=PAGE;}
    entries=next;options();render();
    hydrate();maybeDetail();
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
