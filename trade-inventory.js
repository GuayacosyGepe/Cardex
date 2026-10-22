(function tradeInventoryModule(){
 'use strict';
 const $=s=>document.querySelector(s),esc=x=>escapeHtml(String(x??''));
 const PAGE=60,offers=new Map(),meta=new Map();
 let owner=null,loading=false,saving=false,currentId=null,draft=0,mode='offered',page=PAGE,modalContext=null;
 function ready(){return Boolean(typeof remoteUser!=='undefined'&&remoteUser?.id&&typeof remoteDataReady!=='undefined'&&remoteDataReady&&typeof supabaseClient!=='undefined'&&supabaseClient)}
 function owned(id){return typeof countFor==='function'?countFor(id):0}
 function active(){return $('#collectionTabTrade')?.hidden===false}
 function feedback(s,error=false){const e=$('#tradePanelStatus');if(e){e.textContent=s;e.classList.toggle('error',error)}}
 function clamp(){for(const [id,q] of offers){const n=Math.min(q,owned(id));if(n<=0)offers.delete(id);else if(n!==q)offers.set(id,n)}}
 async function load(){
   if(!ready()){owner=null;offers.clear();draw();modalUI();return}
   const uid=remoteUser.id;owner=uid;if(loading)return;
   loading=true;draw();
   let all=[];
   try{
     for(let offset=0;offset<50000;offset+=500){
       const r=await supabaseClient.from('trade_inventory').select('card_id,available_quantity').eq('user_id',uid)
         .order('card_id',{ascending:true}).range(offset,offset+499);
       if(r.error)throw r.error;
       all.push(...(r.data||[]));
       if((r.data||[]).length<500)break;
     }
     if(!ready()||remoteUser.id!==uid)return;
     offers.clear();all.forEach(x=>{if(x.available_quantity>0)offers.set(x.card_id,Number(x.available_quantity))});
     clamp();feedback('');
   }catch(e){if(ready()&&remoteUser.id===uid)feedback('Error cargando ofertas: '+e.message,true)}
   finally{loading=false;if(owner===uid){draw();modalUI()}}
 }
 function modalUI(){
   const block=$('#tradeCardControls'),card=typeof currentCard!=='undefined'?currentCard:null;
   if(!block)return;
   const visible=$('#cardModal')?.classList.contains('open')&&Boolean(card);
   block.hidden=!visible;
   if(!visible){currentId=null;return}
   const id=card.id,n=owned(id),can=ready()&&owner===remoteUser.id&&!saving;
   if(currentId!==id){currentId=id;draft=offers.get(id)||0;$('#tradeCardFeedback').textContent=''}
   draft=Math.min(draft,n);
   $('#tradeOwnedLabel').textContent=n;
   $('#tradeOfferNumber').textContent=draft;
   $('#tradeOfferMinus').disabled=!can||draft===0;
   $('#tradeOfferPlus').disabled=!can||draft>=n;
   $('#tradeOfferSave').disabled=!can||(!n&&!offers.has(id));
   $('#tradeUniqueWarning').hidden=draft===0||draft!==n;
   $('#tradeCardHelp').textContent=!ready()?'Inicia sesión para ofrecer cartas.':
     n===0?'Añade esta carta a tu colección para ofrecerla.':
     'Solo tus amigos aceptados verán las copias disponibles.';
 }
 async function save(){
   if(!ready()||saving||!currentId||owner!==remoteUser.id)return;
   const id=currentId,uid=remoteUser.id,n=owned(id),q=Math.max(0,Math.min(n,draft));
   if(q>0&&q===n&&!window.confirm(n===1?
       'Esta es tu única copia. Si se realiza el intercambio, dejarás de tener esta carta. ¿Publicarla igualmente?':
       'Vas a ofrecer todas tus copias de esta carta. ¿Confirmas?'))return;
   saving=true;modalUI();
   try{
     const r=q===0?await supabaseClient.from('trade_inventory').delete().eq('user_id',uid).eq('card_id',id):
       await supabaseClient.from('trade_inventory').upsert({user_id:uid,card_id:id,available_quantity:q},{onConflict:'user_id,card_id'});
     if(r.error)throw r.error;
     if(!ready()||remoteUser.id!==uid)return;
     if(q>0)offers.set(id,q);else offers.delete(id);
     $('#tradeCardFeedback').textContent=q?`Ofreces ${q} copia(s). Guardado.`:'Carta retirada de intercambios.';
     feedback('Ofertas actualizadas.');draw();
   }catch(e){if(ready()&&remoteUser.id===uid){$('#tradeCardFeedback').textContent=e.message;feedback('No se pudo guardar: '+e.message,true)}}
   finally{saving=false;modalUI()}
 }
 function items(){
   const query=$('#tradeSearch')?.value?.toLocaleLowerCase('es')?.trim()||'';
   const raw=mode==='duplicates'?
     Object.entries(typeof collection!=='undefined'?collection:{}).filter(([,q])=>Number(q)>1).map(([id,q])=>({id,q:offers.get(id)||0,owned:Number(q)})):
     [...offers].map(([id,q])=>({id,q,owned:owned(id)}));
   return raw.filter(x=>x.owned>0&&(!query||[x.id,meta.get(x.id)?.name||''].join(' ').toLocaleLowerCase('es').includes(query)))
     .sort((a,b)=>a.id.localeCompare(b.id,'es',{numeric:true}));
 }
 function draw(){
   if(!$('#collectionTabTrade'))return;
   const signed=ready();
   $('#tradeLoggedOut').hidden=signed;$('#tradeLoggedIn').hidden=!signed;
   if(!signed)return;
   $('#tradeUnique').textContent=offers.size;
   $('#tradeCopies').textContent=[...offers.values()].reduce((a,b)=>a+b,0);
   $('#tradeModeOffered').classList.toggle('active',mode==='offered');
   $('#tradeModeDuplicates').classList.toggle('active',mode==='duplicates');
   const list=items(),visible=list.slice(0,page);
   $('#tradeResultsLabel').textContent=mode==='offered'?`${list.length} cartas ofrecidas`:`${list.length} cartas repetidas`;
   $('#tradeCards').innerHTML=visible.map(x=>`<button class="trade-library-card" type="button" data-card-id="${esc(x.id)}">
     <span class="trade-library-cover"><span class="trade-library-placeholder">▤</span><img loading="lazy" decoding="async" alt=""></span>
     <strong class="trade-library-name">${esc(meta.get(x.id)?.name||'Cargando carta…')}</strong>
     <small>${esc(x.id)}</small>
     <span class="trade-library-quantity">${x.q?'Ofrezco ×'+x.q:'Sin ofrecer'} · Tengo ×${x.owned}</span>
   </button>`).join('')||`<p class="trade-empty">${mode==='offered'?
     'Aún no has marcado cartas. Abre una carta desde el buscador o tus expansiones para ofrecerla.':
     'No tienes cartas repetidas.'}</p>`;
   $('#tradeMore').hidden=list.length<=page;
   $('#tradeMore').textContent=`Mostrar más (${list.length-visible.length})`;
   if(active())hydrate(visible).catch(console.warn);
 }
 async function info(id){if(meta.has(id))return meta.get(id);const card=await getCardDetail(id);meta.set(id,card);return card}
 async function hydrate(list){
   const uid=owner;let at=0;
   await Promise.all(Array.from({length:Math.min(4,list.length)},async()=>{
     while(at<list.length&&uid===owner&&active()){
       const id=list[at++].id;
       try{
         const card=await info(id);
         if(owner!==uid||!active())return;
         const row=[...$('#tradeCards').querySelectorAll('[data-card-id]')].find(x=>x.dataset.cardId===id);
         if(!row)continue;
         row.querySelector('.trade-library-name').textContent=card?.name||id;
         const img=row.querySelector('img'),cover=row.querySelector('.trade-library-cover');
         const urls=[imageUrl(card,'low'),card?.image?card.image+'/low.png':'',card?.image?card.image+'/high.webp':''].filter(Boolean);
         if(!urls.length){row.querySelector('.trade-library-placeholder').textContent='Sin imagen';continue}
         let k=0;
         img.onload=()=>cover.classList.add('has-image');
         img.onerror=()=>{k++;if(k<urls.length)img.src=urls[k];else{img.removeAttribute('src');row.querySelector('.trade-library-placeholder').textContent='Sin imagen'}};
         img.src=urls[0];
       }catch{}
     }
   }));
 }
 function restore(){
   if(!modalContext)return;
   const b=modalContext;modalContext=null;
   currentSet=b.set;currentSetCards=b.setCards;currentVisibleCards=b.visibleCards;
   currentPokemon=b.pokemon;currentCard=b.card;currentCardFull=b.full;
 }
 async function openOwn(id){
   if(!ready()||!active()||$('#cardModal').classList.contains('open'))return;
   let card;try{card=await info(id)}catch{card={id,name:id,localId:id.split('-').at(-1)}}
   if(!ready()||!active()||$('#cardModal').classList.contains('open'))return;
   modalContext={set:currentSet,setCards:currentSetCards,visibleCards:currentVisibleCards,pokemon:currentPokemon,card:currentCard,full:currentCardFull};
   currentSet=null;currentSetCards=[];currentVisibleCards=[card];currentPokemon=null;
   try{await openCard(id)}catch(e){restore();feedback(e.message,true)}
 }
 function init(){
   $('#tradeOfferMinus').onclick=()=>{draft=Math.max(0,draft-1);modalUI()};
   $('#tradeOfferPlus').onclick=()=>{draft=Math.min(owned(currentId),draft+1);modalUI()};
   $('#tradeOfferSave').onclick=save;
   $('#tradeModeOffered').onclick=()=>{mode='offered';page=PAGE;draw()};
   $('#tradeModeDuplicates').onclick=()=>{mode='duplicates';page=PAGE;draw()};
   $('#tradeSearch').oninput=()=>{page=PAGE;draw()};
   $('#tradeMore').onclick=()=>{page+=PAGE;draw()};
   $('#tradeCards').addEventListener('click',e=>{const c=e.target.closest('[data-card-id]');if(c)openOwn(c.dataset.cardId).catch(console.warn)});
   $('#tradeLoggedOut button').onclick=()=>{if(typeof openAuthModal==='function')openAuthModal('login')};
   const modal=$('#cardModal');
   new MutationObserver(()=>{if(!modal.classList.contains('open'))restore();modalUI()})
     .observe(modal,{attributes:true,attributeFilter:['class']});
   new MutationObserver(()=>modalUI()).observe($('#cardModalTitle'),{childList:true,subtree:true,characterData:true});
   new MutationObserver(()=>{clamp();modalUI();if(active())draw()})
     .observe($('#homeTotalCopies'),{childList:true,subtree:true,characterData:true});
   new MutationObserver(()=>{if(active())draw()})
     .observe($('#collectionTabTrade'),{attributes:true,attributeFilter:['hidden']});
   const sync=$('#syncStatusBadge');
   if(sync)new MutationObserver(()=>{
     if(!ready()){owner=null;offers.clear();draw();modalUI()}
     else if(owner!==remoteUser.id)load();
   }).observe(sync,{childList:true,subtree:true,characterData:true});
   if(ready())load();else draw();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
