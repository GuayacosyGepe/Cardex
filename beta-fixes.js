/* CardDex beta fixes — comportamiento añadido durante pruebas con usuarios. */
(() => {
  // CardDex cataloga exclusivamente el TCG físico. TCGdex agrupa Pocket bajo tcgp,
  // pero mantenemos varias señales de respaldo para evitar fugas por búsquedas directas.
  function isPocketEntity(entity={}){
    const id=String(entity.id||entity.tcgId||entity.cardId||'').trim();
    const haystack=[
      entity.seriesId, entity.seriesName, entity.name, entity.logo,
      entity.symbol, entity.image, id
    ].filter(Boolean).join(' ').toLowerCase();
    if(haystack.includes('tcgp')||haystack.includes('tcg pocket')||haystack.includes('pokemon pocket')||haystack.includes('pokémon pocket'))return true;
    // IDs actuales/futuros habituales de Pocket (A1, A1a, B1, P-A y sus cartas).
    if(/^(?:[ab]\d+(?:[a-z])?|p-a)(?:-|$)/i.test(id))return true;
    return false;
  }

  function purgePocketCatalog(){
    try{
      if(typeof seriesCatalog==='undefined'||typeof sets==='undefined'||!Array.isArray(seriesCatalog)||!Array.isArray(sets))return false;
      if(!seriesCatalog.length&&!sets.length)return false;
      const beforeSeries=seriesCatalog.length;
      const beforeSets=sets.length;

      for(let i=seriesCatalog.length-1;i>=0;i--){
        const serie=seriesCatalog[i];
        if(isPocketEntity(serie)){
          seriesCatalog.splice(i,1);
          continue;
        }
        if(Array.isArray(serie.sets)){
          serie.sets=serie.sets.filter(set=>!isPocketEntity({...set,seriesId:set.seriesId||serie.id,seriesName:set.seriesName||serie.name}));
          if(!serie.sets.length)seriesCatalog.splice(i,1);
        }
      }

      const allowed=new Set(seriesCatalog.flatMap(serie=>serie.sets||[]).map(set=>String(set.tcgId||set.id)));
      for(let i=sets.length-1;i>=0;i--){
        if(isPocketEntity(sets[i])||!allowed.has(String(sets[i].tcgId||sets[i].id)))sets.splice(i,1);
      }

      const changed=beforeSeries!==seriesCatalog.length||beforeSets!==sets.length;
      if(changed){
        if(typeof populateEraFilter==='function')populateEraFilter();
        if(typeof renderLibrary==='function')renderLibrary();
        if(typeof renderMyCollectionSets==='function')renderMyCollectionSets();
        if(typeof updateCatalogStats==='function')updateCatalogStats();
      }
      return true;
    }catch(err){
      console.warn('CardDex Pocket filter:',err);
      return false;
    }
  }

  function armPocketCatalogGuard(){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      const ready=purgePocketCatalog();
      if((ready&&typeof sets!=='undefined'&&sets.length)||attempts>=40)clearInterval(timer);
    },250);
  }

  function initGlobalSearchAutocomplete(){
    const input=document.querySelector('#search');
    const wrap=input?.closest('.search');
    if(!input||!wrap||wrap.querySelector('.global-search-suggestions'))return;

    const panel=document.createElement('div');
    panel.className='global-search-suggestions';
    panel.hidden=true;
    panel.setAttribute('role','listbox');
    panel.setAttribute('aria-label','Sugerencias de búsqueda');
    wrap.appendChild(panel);
    input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-expanded','false');

    const api='https://api.tcgdex.net/v2/es';
    let timer=null;
    let requestId=0;
    let activeIndex=-1;
    let visibleButtons=[];
    let latestCards=[];

    const norm=value=>typeof normalizeText==='function'
      ? normalizeText(value)
      : String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const esc=value=>typeof escapeHtml==='function'
      ? escapeHtml(value)
      : String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));

    function closeSuggestions(){
      panel.hidden=true;
      input.setAttribute('aria-expanded','false');
      activeIndex=-1;
      visibleButtons=[];
    }

    function scoreLabel(label,n){
      const value=norm(label);
      if(value===n)return 0;
      if(value.startsWith(n))return 1;
      const words=value.split(' ');
      if(words.some(word=>word.startsWith(n)))return 2;
      return 3;
    }

    function getLocalMatches(query){
      const n=norm(query);
      const pokeList=(typeof pokemon!=='undefined'&&Array.isArray(pokemon))?pokemon:[];
      const setList=(typeof sets!=='undefined'&&Array.isArray(sets))?sets.filter(set=>!isPocketEntity(set)):[];

      const pokeMatches=pokeList
        .filter(p=>norm(p.displayName||p.name).includes(n)||String(p.id).startsWith(n))
        .sort((a,b)=>scoreLabel(a.displayName||a.name,n)-scoreLabel(b.displayName||b.name,n)||a.id-b.id)
        .slice(0,5);

      const setMatches=setList
        .filter(s=>norm(s.name).includes(n)||norm(s.code).includes(n))
        .sort((a,b)=>scoreLabel(a.name,n)-scoreLabel(b.name,n))
        .slice(0,4);

      return {pokeMatches,setMatches};
    }

    function pokemonImg(p){
      if(typeof pokemonArtwork==='function')return pokemonArtwork(p.id);
      return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`;
    }

    function cardImg(card){
      if(typeof imageUrl==='function')return imageUrl(card,'low');
      return card?.image?`${card.image}/low.webp`:'';
    }

    function render(query,{pokeMatches=[],setMatches=[],cardMatches=[],loadingCards=false}={}){
      if(norm(input.value)!==norm(query))return;
      let html='';

      if(pokeMatches.length){
        html+=`<div class="global-search-group"><div class="global-search-group-title">Pokémon</div>${pokeMatches.map(p=>`<button type="button" class="global-search-item" data-suggest-kind="pokemon" data-poke-id="${p.id}" role="option"><span class="global-search-thumb pokemon"><img src="${pokemonImg(p)}" alt=""></span><span class="global-search-copy"><strong>${esc(p.displayName||p.name)}</strong><small>#${String(p.id).padStart(4,'0')} · Ver todas sus cartas</small></span><span class="global-search-arrow">›</span></button>`).join('')}</div>`;
      }

      if(setMatches.length){
        html+=`<div class="global-search-group"><div class="global-search-group-title">Expansiones</div>${setMatches.map(s=>`<button type="button" class="global-search-item" data-suggest-kind="set" data-set-id="${esc(s.tcgId||s.id||'')}" role="option"><span class="global-search-thumb set">${s.logo?`<img src="${esc(s.logo)}" alt="">`:'▦'}</span><span class="global-search-copy"><strong>${esc(s.name)}</strong><small>${esc(s.seriesName||'Expansión')} · ${esc(s.code||s.id||'')}</small></span><span class="global-search-arrow">›</span></button>`).join('')}</div>`;
      }

      if(cardMatches.length){
        html+=`<div class="global-search-group"><div class="global-search-group-title">Cartas</div>${cardMatches.map(card=>`<button type="button" class="global-search-item card-result" data-suggest-kind="card" data-card-id="${esc(card.id)}" role="option"><span class="global-search-thumb card">${cardImg(card)?`<img src="${cardImg(card)}" alt="">`:'◫'}</span><span class="global-search-copy"><strong>${esc(card.name)}</strong><small>#${esc(card.localId||'—')} · ${esc(card.id||'')}</small></span><span class="global-search-arrow">›</span></button>`).join('')}</div>`;
      }

      if(loadingCards){
        html+=`<div class="global-search-loading"><span></span> Buscando cartas…</div>`;
      }

      if(!html){
        html='<div class="global-search-empty">No encontramos coincidencias todavía.</div>';
      }

      panel.innerHTML=html;
      panel.hidden=false;
      input.setAttribute('aria-expanded','true');
      activeIndex=-1;
      visibleButtons=[...panel.querySelectorAll('.global-search-item')];
    }

    async function loadCardMatches(query,local){
      const thisRequest=++requestId;
      try{
        const response=await fetch(`${api}/cards?name=${encodeURIComponent(query)}`);
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        let cards=await response.json();
        if(thisRequest!==requestId||norm(input.value)!==norm(query))return;
        const n=norm(query);
        cards=(Array.isArray(cards)?cards:[])
          .filter(card=>!isPocketEntity(card)&&norm(card.name).includes(n))
          .sort((a,b)=>scoreLabel(a.name,n)-scoreLabel(b.name,n)||String(a.localId).localeCompare(String(b.localId),undefined,{numeric:true}))
          .slice(0,6);
        latestCards=cards;
        render(query,{...local,cardMatches:cards,loadingCards:false});
      }catch{
        if(thisRequest!==requestId)return;
        latestCards=[];
        render(query,{...local,cardMatches:[],loadingCards:false});
      }
    }

    function updateSuggestions(){
      const query=input.value.trim();
      clearTimeout(timer);
      requestId++;
      latestCards=[];
      if(query.length<2){closeSuggestions();return;}
      const local=getLocalMatches(query);
      render(query,{...local,cardMatches:[],loadingCards:true});
      timer=setTimeout(()=>loadCardMatches(query,local),230);
    }

    function refreshActive(){
      visibleButtons.forEach((button,index)=>{
        const active=index===activeIndex;
        button.classList.toggle('active',active);
        button.setAttribute('aria-selected',active?'true':'false');
      });
      visibleButtons[activeIndex]?.scrollIntoView({block:'nearest'});
    }

    function activate(button){
      if(!button)return;
      const kind=button.dataset.suggestKind;
      closeSuggestions();
      if(kind==='pokemon'){
        const id=Number(button.dataset.pokeId);
        const p=(typeof pokemon!=='undefined'&&Array.isArray(pokemon))?pokemon.find(x=>x.id===id):null;
        if(p&&typeof openPokemonCards==='function')openPokemonCards(p,'finder');
        return;
      }
      if(kind==='set'){
        const id=button.dataset.setId;
        if(id&&typeof openExpansion==='function')openExpansion(id,'explore');
        return;
      }
      if(kind==='card'){
        const id=button.dataset.cardId;
        if(typeof currentVisibleCards!=='undefined')currentVisibleCards=latestCards.slice();
        if(typeof currentSet!=='undefined')currentSet=null;
        if(typeof currentPokemon!=='undefined')currentPokemon=null;
        if(id&&typeof openCard==='function')openCard(id);
      }
    }

    input.addEventListener('input',updateSuggestions);
    input.addEventListener('focus',()=>{if(input.value.trim().length>=2)updateSuggestions()});

    // Captura las teclas antes del listener original de Enter de app.js.
    input.addEventListener('keydown',event=>{
      if(panel.hidden)return;
      if(event.key==='ArrowDown'){
        event.preventDefault();event.stopImmediatePropagation();
        if(!visibleButtons.length)return;
        activeIndex=(activeIndex+1)%visibleButtons.length;refreshActive();
      }else if(event.key==='ArrowUp'){
        event.preventDefault();event.stopImmediatePropagation();
        if(!visibleButtons.length)return;
        activeIndex=activeIndex<=0?visibleButtons.length-1:activeIndex-1;refreshActive();
      }else if(event.key==='Enter'&&activeIndex>=0){
        event.preventDefault();event.stopImmediatePropagation();activate(visibleButtons[activeIndex]);
      }else if(event.key==='Escape'){
        event.preventDefault();event.stopImmediatePropagation();closeSuggestions();
      }
    },true);

    panel.addEventListener('mousedown',event=>event.preventDefault());
    panel.addEventListener('click',event=>activate(event.target.closest('.global-search-item')));
    document.addEventListener('click',event=>{if(!wrap.contains(event.target))closeSuggestions()});
  }

  function initBetaFixes(){
    armPocketCatalogGuard();
    initGlobalSearchAutocomplete();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initBetaFixes,{once:true});
  else initBetaFixes();
})();
