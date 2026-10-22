/* CardDex — Amigos: las autorizaciones reales se aplican en Supabase RLS. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s);
 const esc=s=>escapeHtml(String(s??''));
 const state={friendships:[],profiles:new Map(),selected:null,friendCards:[],busy:false,loading:false};
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
   if(!logged)return;
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
     state.selected=null;$('#friendsComparison').hidden=true;
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
   <div class="friend-trade-list">${rows.length?rows.map(x=>`<div class="friend-trade-entry" data-trade-id="${esc(x.id)}">
     <span class="friend-trade-thumb" aria-hidden="true"><span class="friend-trade-placeholder">▤</span><img loading="lazy" decoding="async" alt="" hidden></span>
     <span class="friend-trade-meta"><span class="friend-trade-name">Buscando carta…</span><small>${esc(x.id)}</small></span>
     <strong class="friend-trade-quantity">×${x.quantity}</strong>
   </div>`).join(''): `<p class="friends-empty">${esc(empty)}</p>`}</div>
   ${items.length>100?'<small>Se muestran las primeras 100 cartas.</small>':''}</section>`;
 }
 function tradeImageCandidates(card){
   const urls=[];
   if(typeof imageUrl==='function'){
     const image=imageUrl(card,'low');
     if(image)urls.push(image);
   }
   if(card?.image){
     urls.push(card.image+'/low.png',card.image+'/high.webp');
   }
   if(typeof classicEnglishImageUrl==='function'){
     const english=classicEnglishImageUrl(card,'low');
     if(english)urls.push(english);
   }
   return [...new Set(urls.filter(Boolean))];
 }
 function showTradeImage(row,card,selected){
   const img=row.querySelector('.friend-trade-thumb img');
   const placeholder=row.querySelector('.friend-trade-placeholder');
   if(!img||!placeholder)return;
   const urls=tradeImageCandidates(card);
   if(!urls.length){
     placeholder.textContent='Sin imagen';
     placeholder.classList.add('is-missing');
     return;
   }
   let index=0;
   img.addEventListener('load',()=>{
     if(state.selected!==selected||!row.isConnected)return;
     img.hidden=false;
     placeholder.hidden=true;
   });
   img.addEventListener('error',()=>{
     if(state.selected!==selected||!row.isConnected)return;
     index++;
     if(index<urls.length){img.src=urls[index];return;}
     img.hidden=true;
     placeholder.hidden=false;
     placeholder.textContent='Sin imagen';
     placeholder.classList.add('is-missing');
   });
   img.src=urls[0];
 }
 async function names(){
   const rows=[...$('#friendsComparison').querySelectorAll('.friend-trade-entry[data-trade-id]')];
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
         const card=await getCardDetail(id);
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
 async function compare(f){
   if(f.status!=='accepted'||!session())return;
   const target=uid(f),ownUser=remoteUser.id;
   state.selected=f.id;
   $('#friendsComparison').hidden=false;
   $('#friendsComparison').innerHTML='<p class="friends-empty">Comparando colecciones…</p>';
   const result=await supabaseClient.from('collection_items').select('card_id,quantity').eq('user_id',target);
   if(result.error){$('#friendsComparison').innerHTML='<p class="friends-empty">No se pudo abrir la colección: '+esc(result.error.message)+'</p>';return}
   if(!session()||remoteUser.id!==ownUser||state.selected!==f.id)return;
   const theirs=(result.data||[]).filter(x=>Number(x.quantity)>0);
   const mine=typeof collection!=='undefined'?collection:{};
   const theyHave=theirs.filter(x=>Number(x.quantity)>1&&Number(mine[x.card_id]||0)===0)
     .map(x=>({id:x.card_id,quantity:x.quantity-1}));
   const iHave=Object.entries(mine).filter(([id,q])=>Number(q)>1&&!theirs.some(c=>c.card_id===id))
     .map(([id,q])=>({id,quantity:Number(q)-1}));
   const friendUnique=theirs.length,friendCopies=theirs.reduce((n,x)=>n+Number(x.quantity),0);
   $('#friendsComparison').innerHTML=`<div class="friend-compare-top"><button id="friendsCloseComparison" type="button">← Volver a amigos</button><h2>Colección de ${esc(profile(target))}</h2><p>${friendUnique} cartas distintas · ${friendCopies} ejemplares</p><small>Comparación por cartas exactas. Solo considera excedentes: cantidad menos 1.</small></div><div class="friends-trade-grid">
   ${tradeGroup('Repetidas que te faltan',theyHave,'Tu amigo no tiene repetidas que te falten.')}
   ${tradeGroup('Tus repetidas que le faltan',iHave,'No tienes repetidas que le falten a tu amigo.')}</div>`;
   $('#friendsCloseComparison').onclick=()=>{state.selected=null;$('#friendsComparison').hidden=true};
   names().catch(console.warn);
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