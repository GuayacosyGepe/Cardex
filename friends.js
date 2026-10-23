/* CardDex — Amigos: las autorizaciones reales se aplican en Supabase RLS. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s);
 const esc=s=>escapeHtml(String(s??''));
 const PAGE_SIZE=60;
 const state={friendships:[],profiles:new Map(),selected:null,friendCards:[],friendOffers:[],busy:false,loading:false,
   friendView:'all',friendPage:PAGE_SIZE,offerPage:PAGE_SIZE,offersError:''};
 const friendCardDetails=new Map();
 function active(){return $('#friends')?.classList.contains('active-view')}
 function session(){return typeof remoteUser!=='undefined'&&remoteUser?.id&&typeof supabaseClient!=='undefined'&&supabaseClient}
 function status(s,error=false){const el=$('#friendsMessage');if(el){el.textContent=s;el.classList.toggle('error',error)}}
 function uid(f){return f.requester_id===remoteUser?.id?f.recipient_id:f.requester_id}
 function profile(id){return state.profiles.get(id)?.display_name||'Entrenador'}
 function label(f){return esc(profile(uid(f)))}
 function avatarUrl(id){
   const p=state.profiles.get(id);
   return typeof avatarSpriteUrl==='function'?avatarSpriteUrl(p?.avatar_pokemon_id||25,p?.avatar_style||'pixel'):'avatar-placeholder.svg';
 }
 function draw(){
   if(!$('#friends'))return;
   const logged=!!session();
   $('#friendsSignedOut').hidden=logged;
   $('#friendsSignedIn').hidden=!logged;
   if(!logged){
     state.selected=null;
     state.friendCards=[];
     $('#friendsComparison').hidden=true;
     return;
   }
   const requests=state.friendships.filter(f=>f.status==='pending'&&f.recipient_id===remoteUser.id);
   const outgoing=state.friendships.filter(f=>f.status==='pending'&&f.requester_id===remoteUser.id);
   const friends=state.friendships.filter(f=>f.status==='accepted');
   const empty=t=>'<p class="friends-empty">'+esc(t)+'</p>';
   $('#friendsRequests').innerHTML=requests.map(f=>`<article class="friend-row"><strong>${label(f)}</strong><div><button data-friend-action="accept" data-id="${f.id}">Aceptar</button><button data-friend-action="decline" data-id="${f.id}">Rechazar</button></div></article>`).join('')||empty('No tienes solicitudes pendientes.');
   $('#friendsOutgoing').innerHTML=outgoing.map(f=>`<article class="friend-row"><span>Solicitud enviada a ${label(f)}</span><button data-friend-action="remove" data-id="${f.id}">Cancelar</button></article>`).join('')||empty('Ninguna solicitud enviada.');
   $('#friendsList').innerHTML=friends.map(f=>`<article class="friend-row"><div class="friend-identity"><img src="${esc(avatarUrl(uid(f)))}" alt="" onerror="this.onerror=null;this.src='avatar-placeholder.svg'"><strong>${label(f)}</strong></div><div><button data-friend-action="view" data-id="${f.id}">Ver colección</button><button data-friend-action="remove" data-id="${f.id}">Eliminar</button></div></article>`).join('')||empty('Aún no has añadido amigos.');
   $('#friendsCount').textContent=String(friends.length);
 }
 async function load(){
   if(!session()){draw();return}
   const userId=remoteUser.id;
   const {data,error}=await supabaseClient.from('carddex_friendships').select('id,requester_id,recipient_id,status').or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);
   if(error){status('No se pudieron cargar los amigos: '+error.message,true);return}
   if(!session()||remoteUser.id!==userId)return;
   state.friendships=data||[];
   const ids=[...new Set(state.friendships.map(uid))];
   state.profiles=new Map();
   if(ids.length){
     const p=await supabaseClient.from('profiles').select('user_id,display_name,avatar_pokemon_id,avatar_style').in('user_id',ids);
     if(!session()||remoteUser.id!==userId)return;
     if(!p.error)(p.data||[]).forEach(x=>state.profiles.set(x.user_id,x));
   }
   if(!session()||remoteUser.id!==userId)return;
   draw();
   if(state.selected&&!state.friendships.some(f=>f.id===state.selected&&f.status==='accepted')){
     state.selected=null;state.friendCards=[];state.friendOffers=[];$('#friendsComparison').hidden=true;
   }
 }
 async function initCode(){
   if(!session())return;
   const result=await supabaseClient.rpc('carddex_my_friend_code');
   if(result.error){status('No se pudo crear tu código: '+result.error.message,true);return}
   $('#myFriendCode').textContent=result.data;
 }
 async function send(){
   if(state.busy||!session())return;
   const code=$('#friendCodeInput').value.trim().toUpperCase();
   if(!/^CD-[A-F0-9]{12}$/.test(code)){status('Introduce un código válido con formato CD-XXXXXXXXXXXX.',true);return}
   state.busy=true;$('#friendSend').disabled=true;
   try{
     const r=await supabaseClient.rpc('carddex_send_friend_request',{p_code:code});
     if(r.error)throw r.error;
     $('#friendCodeInput').value='';status('Solicitud enviada. Tu amigo tendrá que aceptarla.');
     await load();
   }catch(e){status(e.message||'No se pudo enviar la solicitud.',true)}
   finally{state.busy=false;$('#friendSend').disabled=false}
 }
 async function action(type,id){
   if(!session()||state.busy)return;
   const f=state.friendships.find(x=>x.id===id);if(!f)return;
   if(type==='view'){await compare(f);return}
   state.busy=true;
   try{
     let r;
     if(type==='accept'||type==='decline')
       r=await supabaseClient.rpc('carddex_reply_friend_request',{p_request_id:id,p_accept:type==='accept'});
     else if(type==='remove'){
       if(f.status==='accepted'&&!window.confirm('¿Eliminar a este amigo? Ya no podréis ver vuestras colecciones.'))return;
       r=await supabaseClient.rpc('carddex_remove_friend',{p_request_id:id});
     }
     if(r?.error)throw r.error;
     status(type==='accept'?'Solicitud aceptada.':type==='decline'?'Solicitud rechazada.':'Relación eliminada.');
     await load();
   }catch(e){status(e.message||'No se pudo actualizar la solicitud.',true)}
   finally{state.busy=false}
 }
 function tradeGroup(title,items,empty){
   const rows=items.slice(0,100);
   return `<section class="friend-trade-group"><h3>${esc(title)} <span>${items.length}</span></h3>
   <div class="friend-trade-list">${rows.length?rows.map(x=>`<div class="friend-trade-entry" data-trade-id="${esc(x.id)}" role="button" tabindex="0" aria-label="Ver ficha de la carta ${esc(x.id)}">
     <span class="friend-trade-thumb" aria-hidden="true"><span class="friend-trade-placeholder">▤</span><img loading="lazy" decoding="async" alt="" width="58" height="81"></span>
     <span class="friend-trade-meta"><span class="friend-trade-name">Buscando carta…</span><small>${esc(x.id)}</small></span>
     <strong class="friend-trade-quantity">×${x.quantity}</strong>
   </div>`).join(''): `<p class="friends-empty">${esc(empty)}</p>`}</div>
   ${items.length>100?'<small>Se muestran las primeras 100 cartas.</small>':''}</section>`;
 }
 function tradeImageCandidates(card){
   // Usar idéntico orden ES → EN → formatos alternativos que el resto de CardDex.
   return typeof cardImageCandidates==='function'?cardImageCandidates(card,'low'):[imageUrl(card,'low')].filter(Boolean);
 }
 function tradeCardWithImage(id){
   if(friendCardDetails.has(id))return friendCardDetails.get(id);
   const job=(async()=>{
     const card=await getCardDetail(id);
     if(card?.image||typeof classicEnglishImageUrl==='function'&&classicEnglishImageUrl(card,'low'))return card;
     // Cuando falta el escaneo ES, utilizar EN sin cambiar el nombre traducido.
     if(typeof fetchJson==='function'&&typeof apiFor==='function'){
       try{
         const english=await fetchJson(apiFor('en')+'/cards/'+encodeURIComponent(id));
         if(english?.image)return {...card,image:english.image};
       }catch{}
     }
     return card;
   })();
   friendCardDetails.set(id,job);
   job.catch(()=>{if(friendCardDetails.get(id)===job)friendCardDetails.delete(id)});
   return job;
 }
 function showTradeImage(row,card,selected){
   const thumb=row.querySelector('.friend-trade-thumb');
   const img=thumb?.querySelector('img');
   const placeholder=thumb?.querySelector('.friend-trade-placeholder');
   if(!thumb||!img||!placeholder)return;
   const urls=tradeImageCandidates(card);
   if(!urls.length){
     placeholder.textContent='Sin imagen';
     placeholder.classList.add('is-missing');
     return;
   }
   let index=0;
   // La imagen nunca se oculta con display:none: impediría su lazy loading.
   // Se mantiene renderizada a opacidad cero mientras se descarga.
   img.addEventListener('load',()=>{
     if(state.selected!==selected||!row.isConnected)return;
     thumb.classList.add('has-image');
   });
   img.addEventListener('error',()=>{
     if(state.selected!==selected||!row.isConnected)return;
     thumb.classList.remove('has-image');
     index++;
     if(index<urls.length){img.src=urls[index];return;}
     img.removeAttribute('src');
     placeholder.textContent='Sin imagen';
     placeholder.classList.add('is-missing');
   });
   img.src=urls[0];
 }
 async function names(containerSelector){
   const container=$(containerSelector);
   if(!container)return;
   const rows=[...container.querySelectorAll('.friend-trade-entry[data-trade-id]')];
   const byId=new Map();
   for(const row of rows){
     const id=row.dataset.tradeId;
     if(!byId.has(id))byId.set(id,[]);
     byId.get(id).push(row);
   }
   const unique=[...byId.keys()];
   const selected=state.selected;
   let index=0;
   await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{
     while(index<unique.length&&state.selected===selected){
       const id=unique[index++];
       try{
         const card=await tradeCardWithImage(id);
         if(state.selected!==selected)return;
         for(const row of byId.get(id)||[]){
           if(!row.isConnected)continue;
           row.querySelector('.friend-trade-name').textContent=card?.name||id;
           showTradeImage(row,card||{id},selected);
         }
       }catch{
         for(const row of byId.get(id)||[]){
           if(!row.isConnected)continue;
           row.querySelector('.friend-trade-name').textContent=id;
           row.querySelector('.friend-trade-placeholder').textContent='Sin imagen';
           row.querySelector('.friend-trade-placeholder').classList.add('is-missing');
         }
       }
     }
   }));
 }
 function friendSetId(id){
   const value=String(id||'');
   return value.slice(0,value.lastIndexOf('-'))||value;
 }
 function friendSetName(id){
   const set=typeof getSetById==='function'?getSetById(id):null;
   return set?.name||id;
 }
 function friendCollectionFilter(){
   const setId=$('#friendAllSet')?.value||'';
   const missing=$('#friendAllMissing')?.checked||false;
   const mine=typeof collection!=='undefined'?collection:{};
   return state.friendCards.filter(item=>
     (!setId||friendSetId(item.id)===setId) &&
     (!missing||Number(mine[item.id]||0)===0)
   );
 }
 function renderFriendCollection(){
   const grid=$('#friendAllCards');
   if(!grid||!state.selected)return;
   const cards=friendCollectionFilter();
   const available=new Map(state.friendOffers.map(c=>[c.id,c.quantity]));
   const showing=cards.slice(0,state.friendPage);
   $('#friendAllCount').textContent=`${cards.length} de ${state.friendCards.length} cartas diferentes`;
   grid.innerHTML=showing.map(item=>`<article class="friend-trade-entry friend-full-card" data-trade-id="${esc(item.id)}" role="button" tabindex="0" aria-label="Ver ficha de la carta ${esc(item.id)}">
     <span class="friend-trade-thumb" aria-hidden="true">
       <span class="friend-trade-placeholder">▤</span>
       <img loading="lazy" decoding="async" alt="" width="132" height="184">
     </span>
     <span class="friend-trade-meta">
       <strong class="friend-trade-name">Cargando carta…</strong>
       <small>${esc(item.id)}</small>
       <small class="friend-full-set">${esc(friendSetName(friendSetId(item.id)))}</small>
       ${available.has(item.id)?`<small class="friend-card-available">Disponible para intercambio ×${available.get(item.id)}</small>`:''}
     </span>
     <strong class="friend-trade-quantity">×${item.quantity}</strong>
   </article>`).join('')||`<p class="friends-empty">${state.friendCards.length?'No hay cartas que coincidan con este filtro.':'Tu amigo todavía no tiene cartas registradas.'}</p>`;
   const more=$('#friendAllMore');
   more.hidden=cards.length<=state.friendPage;
   more.textContent=`Mostrar más (${cards.length-showing.length})`;
   if(state.friendView==='all')names('#friendAllCards').catch(console.warn);
 }
 function renderFriendOffers(){
   const grid=$('#friendOffersCards');
   if(!grid||!state.selected)return;
   const showing=state.friendOffers.slice(0,state.offerPage);
   $('#friendOffersCount').textContent=state.offersError?
     'No se pudieron consultar las ofertas: '+state.offersError:
     state.friendOffers.length+' cartas disponibles para intercambio';
   grid.innerHTML=showing.map(item=>`<article class="friend-trade-entry friend-full-card" data-trade-id="${esc(item.id)}"
     role="button" tabindex="0" aria-label="Ver carta intercambiable ${esc(item.id)}">
     <span class="friend-trade-thumb" aria-hidden="true">
       <span class="friend-trade-placeholder">▤</span>
       <img loading="lazy" decoding="async" alt="" width="132" height="184">
     </span>
     <span class="friend-trade-meta"><strong class="friend-trade-name">Cargando carta…</strong>
       <small>${esc(item.id)}</small>
       <small class="friend-card-available">Ofrece ×${item.quantity}</small>
     </span>
     <strong class="friend-trade-quantity">×${item.quantity}</strong>
   </article>`).join('')||`<p class="friends-empty">${state.offersError?'Ofertas temporalmente no disponibles.':
     'Este amigo todavía no ha marcado cartas disponibles para intercambio.'}</p>`;
   const more=$('#friendOffersMore');
   more.hidden=state.friendOffers.length<=state.offerPage;
   more.textContent=`Mostrar más (${state.friendOffers.length-showing.length})`;
   if(state.friendView==='offers')names('#friendOffersCards').catch(console.warn);
 }
 function switchFriendView(view){
   if(!state.selected)return;
   state.friendView=['all','trades','offers'].includes(view)?view:'all';
   $('#friendAllPanel').hidden=state.friendView!=='all';
   $('#friendTradesPanel').hidden=state.friendView!=='trades';
   $('#friendOffersPanel').hidden=state.friendView!=='offers';
   $('#friendsComparison').querySelectorAll('[data-friend-view]').forEach(button=>{
     const on=button.dataset.friendView===state.friendView;
     button.classList.toggle('active',on);
     button.setAttribute('aria-pressed',String(on));
   });
   if(state.friendView==='all')renderFriendCollection();
   else if(state.friendView==='trades')names('#friendTradesPanel').catch(console.warn);
   else renderFriendOffers();
 }
 function setupFriendCollection(theirs){
   const select=$('#friendAllSet');
   const ids=[...new Set(theirs.map(item=>friendSetId(item.id)))];
   ids.sort((a,b)=>friendSetName(a).localeCompare(friendSetName(b),'es'));
   select.innerHTML='<option value="">Todas las expansiones</option>'+
     ids.map(id=>`<option value="${esc(id)}">${esc(friendSetName(id))}</option>`).join('');
   select.addEventListener('change',()=>{state.friendPage=PAGE_SIZE;renderFriendCollection()});
   $('#friendAllMissing').addEventListener('change',()=>{state.friendPage=PAGE_SIZE;renderFriendCollection()});
   $('#friendAllMore').addEventListener('click',()=>{state.friendPage+=PAGE_SIZE;renderFriendCollection()});
   $('#friendOffersMore').addEventListener('click',()=>{state.offerPage+=PAGE_SIZE;renderFriendOffers()});
   $('#friendsComparison').querySelectorAll('[data-friend-view]').forEach(button=>
     button.addEventListener('click',()=>switchFriendView(button.dataset.friendView)));
   switchFriendView('all');
 }
 async function fetchAllFriendCards(target){
   // Supabase devuelve como máximo una página por solicitud: no truncar las colecciones grandes.
   const output=[],limit=500;
   for(let offset=0;offset<50000;offset+=limit){
     const result=await supabaseClient.from('collection_items')
       .select('card_id,quantity').eq('user_id',target)
       .order('card_id',{ascending:true}).range(offset,offset+limit-1);
     if(result.error)throw result.error;
     const batch=result.data||[];
     output.push(...batch);
     if(batch.length<limit)return output;
   }
   throw new Error('La colección supera el límite de carga permitido.');
 }
 async function fetchFriendOffers(target){
   const rows=[],limit=500;
   for(let offset=0;offset<50000;offset+=limit){
     const result=await supabaseClient.from('trade_inventory')
       .select('card_id,available_quantity').eq('user_id',target)
       .order('card_id',{ascending:true}).range(offset,offset+limit-1);
     if(result.error)throw result.error;
     const batch=result.data||[];
     rows.push(...batch);
     if(batch.length<limit)return rows;
   }
   throw new Error('El inventario de intercambio supera el límite de carga.');
 }
 async function compare(f){
   if(f.status!=='accepted'||!session())return;
   const target=uid(f),ownUser=remoteUser.id;
   state.selected=f.id;
   state.friendView='all';
   state.friendPage=PAGE_SIZE;
   state.offerPage=PAGE_SIZE;
   state.friendCards=[];state.friendOffers=[];state.offersError='';
   $('#friendsComparison').hidden=false;
   $('#friendsComparison').innerHTML='<p class="friends-empty">Cargando colección de tu amigo…</p>';
   let rows;
   try{rows=await fetchAllFriendCards(target)}
   catch(error){
     if(session()&&remoteUser.id===ownUser&&state.selected===f.id)
       $('#friendsComparison').innerHTML='<p class="friends-empty">No se pudo abrir la colección: '+esc(error.message||'Error de conexión')+'</p>';
     return;
   }
   if(!session()||remoteUser.id!==ownUser||state.selected!==f.id)return;
   const theirs=rows.filter(x=>Number(x.quantity)>0).map(x=>({id:x.card_id,quantity:Number(x.quantity)}));
   state.friendCards=theirs;
   try{
     const offers=await fetchFriendOffers(target);
     if(!session()||remoteUser.id!==ownUser||state.selected!==f.id)return;
     const cardIds=new Set(theirs.map(c=>c.id));
     state.friendOffers=offers.filter(x=>Number(x.available_quantity)>0&&cardIds.has(x.card_id))
       .map(x=>({id:x.card_id,quantity:Number(x.available_quantity)}));
   }catch(error){
     if(!session()||remoteUser.id!==ownUser||state.selected!==f.id)return;
     state.offersError=error.message||'Error de conexión';
   }
   const mine=typeof collection!=='undefined'?collection:{};
   const theyHave=theirs.filter(x=>Number(x.quantity)>1&&Number(mine[x.card_id]||0)===0)
     .map(x=>({id:x.card_id,quantity:x.quantity-1}));
   const friendCardIds=new Set(theirs.map(c=>c.id));
   const iHave=Object.entries(mine).filter(([id,q])=>Number(q)>1&&!friendCardIds.has(id))
     .map(([id,q])=>({id,quantity:Number(q)-1}));
   const friendUnique=theirs.length,friendCopies=theirs.reduce((n,x)=>n+Number(x.quantity),0);
   $('#friendsComparison').innerHTML=`<div class="friend-compare-top">
     <button id="friendsCloseComparison" type="button">← Volver a amigos</button>
     <h2>Colección de ${esc(profile(target))}</h2>
     <p>${friendUnique} cartas distintas · ${friendCopies} ejemplares</p>
   </div>
   <div class="friend-view-tabs" role="group" aria-label="Qué mostrar de la colección">
     <button type="button" class="active" data-friend-view="all" aria-pressed="true">▦ Colección completa</button>
     <button type="button" data-friend-view="trades" aria-pressed="false">⇄ Intercambios</button>
     <button type="button" data-friend-view="offers" aria-pressed="false">✧ Disponibles</button>
   </div>
   <section id="friendAllPanel">
     <div class="friend-full-toolbar">
       <label>Expansión <select id="friendAllSet"><option value="">Todas las expansiones</option></select></label>
       <label class="friend-full-check"><input id="friendAllMissing" type="checkbox"> Solo las que me faltan</label>
     </div>
     <p id="friendAllCount" class="friend-full-count"></p>
     <p class="friend-card-hint">Pulsa cualquier carta para abrir su ficha completa.</p>
     <div id="friendAllCards" class="friend-full-grid"></div>
     <button id="friendAllMore" class="friend-full-more" type="button" hidden>Mostrar más</button>
   </section>
   <section id="friendOffersPanel" hidden>
     <p class="friend-trades-intro">Solo las cartas que tu amigo ha marcado expresamente para intercambiar.</p>
     <p id="friendOffersCount" class="friend-full-count"></p>
     <div id="friendOffersCards" class="friend-full-grid"></div>
     <button id="friendOffersMore" class="friend-full-more" type="button" hidden>Mostrar más</button>
   </section>
   <section id="friendTradesPanel" hidden>
     <p class="friend-trades-intro">Posibles intercambios basados en repetidas, aunque no estén publicadas. Para ver ofertas confirmadas, abre «Disponibles». Pulsa una carta para ver su ficha completa.</p>
     <div class="friends-trade-grid">
       ${tradeGroup('Repetidas que te faltan',theyHave,'Tu amigo no tiene repetidas que te falten.')}
       ${tradeGroup('Tus repetidas que le faltan',iHave,'No tienes repetidas que le falten a tu amigo.')}
     </div>
   </section>`;
   $('#friendsCloseComparison').onclick=()=>{state.selected=null;state.friendCards=[];state.friendOffers=[];$('#friendsComparison').hidden=true};
   setupFriendCollection(theirs);
 }
 // Reutilizar exactamente el modal del buscador, sin duplicar la ficha.
 // El contexto global de cartas se restaura cuando se cierra el modal.
 let friendModalContext=null;
 function restoreFriendModalContext(){
   if(!friendModalContext)return;
   const before=friendModalContext;
   friendModalContext=null;
   currentSet=before.set;
   currentSetCards=before.setCards;
   currentVisibleCards=before.visibleCards;
   currentPokemon=before.pokemon;
   currentCard=before.card;
   currentCardFull=before.full;
 }
 async function openFriendCard(row){
   if(!row||row.dataset.opening==='true'||!active()||!session()||!state.selected)return;
   if(!state.friendships.some(f=>f.id===state.selected&&f.status==='accepted'))return;
   if($('#cardModal')?.classList.contains('open'))return;
   const id=row.dataset.tradeId;
   if(!id)return;
   const selected=state.selected,owner=remoteUser.id;
   row.dataset.opening='true';
   row.classList.add('opening-card');
   try{
     let card;
     try{card=await tradeCardWithImage(id)}
     catch{
       // Aun sin ficha descargada, permitir abrir el modal con los datos disponibles.
       card={id,name:row.querySelector('.friend-trade-name')?.textContent||id};
     }
     if(!session()||remoteUser.id!==owner||state.selected!==selected||!active()||!row.isConnected)return;
     if($('#cardModal')?.classList.contains('open'))return;
     const brief={
       ...card,id,
       name:card?.name||id,
       localId:card?.localId||id.split('-').at(-1)
     };
     friendModalContext={
       set:currentSet,setCards:currentSetCards,visibleCards:currentVisibleCards,
       pokemon:currentPokemon,card:currentCard,full:currentCardFull
     };
     currentSet=null;
     currentSetCards=[];
     currentVisibleCards=[brief];
     currentPokemon=null;
     try{await openCard(id)}
     catch(error){
       restoreFriendModalContext();
       status('No se pudo abrir la ficha: '+(error?.message||'error desconocido'),true);
     }
   }finally{
     row.dataset.opening='false';
     row.classList.remove('opening-card');
   }
 }
 function bindFriendCardModal(){
   const comparison=$('#friendsComparison'),modal=$('#cardModal');
   if(!comparison||!modal)return;
   comparison.addEventListener('click',event=>{
     const row=event.target.closest('.friend-trade-entry[data-trade-id]');
     if(row&&comparison.contains(row))openFriendCard(row).catch(console.warn);
   });
   comparison.addEventListener('keydown',event=>{
     if(event.key!=='Enter'&&event.key!==' ')return;
     const row=event.target.closest('.friend-trade-entry[data-trade-id]');
     if(!row||!comparison.contains(row))return;
     event.preventDefault();
     openFriendCard(row).catch(console.warn);
   });
   new MutationObserver(()=>{
     if(!modal.classList.contains('open'))restoreFriendModalContext();
   }).observe(modal,{attributes:true,attributeFilter:['class']});
 }
 function renderShell(){
   const root=$('#friends');if(!root)return;
   root.innerHTML=`<div class="eyebrow">CARDEX SOCIAL</div><h1>Amigos</h1><p class="lead">Compartid vuestras colecciones e identificad cartas para intercambiar.</p>
   <div id="friendsSignedOut" class="friends-panel"><h2>Inicia sesión</h2><p>Necesitas una cuenta sincronizada para usar Amigos.</p><button id="friendsLogin">Entrar en mi cuenta</button></div>
   <div id="friendsSignedIn" hidden>
    <div class="friends-grid">
     <section class="friends-panel"><h2>Tu código de amigo</h2><p>Compártelo solo con quienes quieras agregar.</p><div class="friends-code"><strong id="myFriendCode">Cargando…</strong><button id="friendCopyCode" type="button">Copiar</button></div></section>
     <section class="friends-panel"><h2>Añadir amigo</h2><p>Introduce el código que te hayan compartido.</p><div class="friends-add"><input id="friendCodeInput" placeholder="CD-XXXXXXXXXXXX" maxlength="15" autocomplete="off"><button id="friendSend" type="button">Enviar solicitud</button></div></section>
    </div>
    <p id="friendsMessage" aria-live="polite"></p>
    <div id="friendsComparison" hidden></div>
    <div class="friends-sections"><section class="friends-panel"><h2>Mis amigos <span id="friendsCount">0</span></h2><div id="friendsList"></div></section>
    <section class="friends-panel"><h2>Solicitudes recibidas</h2><div id="friendsRequests"></div><h2>Solicitudes enviadas</h2><div id="friendsOutgoing"></div></section></div>
   </div>`;
   $('#friendsLogin').onclick=()=>{if(typeof openAuthModal==='function')openAuthModal()};
   $('#friendCopyCode').onclick=async()=>{const code=$('#myFriendCode').textContent;if(code.startsWith('CD-')){try{await navigator.clipboard.writeText(code);status('Código copiado.')}catch{status('Selecciona y copia tu código manualmente.')}}};
   $('#friendSend').onclick=send;
   $('#friendCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter')send()});
   bindFriendCardModal();
   root.addEventListener('click',e=>{
     const button=e.target.closest('[data-friend-action]');if(button)action(button.dataset.friendAction,button.dataset.id);
   });
 }
 let syncId=null;
 async function refresh(){
   if(!active())return;
   draw();
   const id=remoteUser?.id||null;
   if(!id){syncId=null;return}
   if(id!==syncId){syncId=id;$('#myFriendCode').textContent='Cargando…';}
   await initCode();await load();
 }
 function init(){
   renderShell();draw();
   const target=$('#friends');
   new MutationObserver(()=>{if(active())refresh()}).observe(target,{attributes:true,attributeFilter:['class']});
   const badge=$('#syncStatusBadge');
   if(badge)new MutationObserver(()=>{if(active())refresh()}).observe(badge,{childList:true,subtree:true,characterData:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();