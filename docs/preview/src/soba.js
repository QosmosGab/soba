/* Soba layer: custom pieces injected after Framer hydrates. Everything is idempotent (keyed by id). */
(function(){
const CL = (c,s)=>'<svg viewBox="0 0 64 64" width="'+s+'" height="'+s+'"><g transform="translate(32 36)">'+[0,120,240].map(r=>'<path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="none" stroke="'+c+'" stroke-width="4.5" stroke-linejoin="round" transform="rotate('+r+')"/>').join('')+'</g></svg>';
const $=(s,r=document)=>r.querySelector(s);
const el=(html)=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild};
const icon={
 wa:'<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.1.6 2.8.5a2.5 2.5 0 0 0 1.6-1.1c.2-.6.2-1 .1-1.1l-.6-.3z"/></svg>',
 mail:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
 sms:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>',
 phone:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.8"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'
};
function splotches(){
  if($('#sb-splotches')) return;
  const main=$('#main'); if(!main) return;
  const H=document.documentElement.scrollHeight;
  const cols=['rgba(0,153,255,.55)','rgba(29,164,98,.5)','rgba(255,169,0,.5)','rgba(248,39,5,.35)','rgba(0,153,255,.45)','rgba(29,164,98,.45)','rgba(255,169,0,.45)','rgba(0,153,255,.4)'];
  const wrap=el('<div id="sb-splotches" style="position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0"></div>');
  const rail=(document.querySelector('.framer-bosabc-container')||{}).getBoundingClientRect?.()||{left:20};
  const railL=Math.max(0,rail.left), railR=innerWidth-railL;
  for(let i=0;i<8;i++){ const side=i%2===0; const y=600+i*(H-1400)/8+(i%3)*90;
    const s=el('<div class="sb-splotch"></div>'); s.style.background='radial-gradient(circle, '+cols[i]+' 0%, rgba(255,255,255,0) 68%)';
    s.style.top=y+'px'; s.style[side?'left':'right']=(side?railL:railL)-200+'px'; s.style.width=(260+(i%3)*60)+'px'; s.style.height=s.style.width; wrap.appendChild(s); }
  document.body.style.position='relative'; document.body.prepend(wrap);
}
function hero(){
  const content=$('[data-framer-name="Hero"] [data-framer-name="Content"]'); if(!content||$('#sb-notifs',content)) return;
  content.style.position='relative';
  const N=[['Order confirmed','Fresh Valley · 320 cs Roma 5x6 · $4,640'],['Order confirmed','Rio Bravo · 200 cs super cucumber · $3,600'],['Order confirmed','Valle Verde · 480 cs bell pepper · $7,920'],['Rep approved','Sun Coast · 150 cs limes · $2,250'],['Order confirmed','Mercado Norte · 260 cs squash · $3,120'],['Order confirmed','Agro Baja · 240 cs cucumber · $4,320'],['Order confirmed','Del Norte · 180 cs mango · $3,960']];
  const wrap=el('<div id="sb-notifs"></div>'); content.appendChild(wrap);
  const slots=[['L',150],['R',230],['L',420],['R',520]]; let idx=0, live=0;
  const pop=()=>{ if(live<1){ const s=slots[idx%slots.length]; const d=N[idx%N.length]; idx++;
      const n=el(`<div class="sb-notif ${s[0]}" style="top:${s[1]}px"><span class="ic">$</span><div class="inner"><b>${d[0]}</b><span>${d[1]}</span></div></div>`);
      wrap.appendChild(n); live++; requestAnimationFrame(()=>n.classList.add('on'));
      setTimeout(()=>{ n.classList.remove('on'); setTimeout(()=>{ n.remove(); live--; },800); }, 4500); }
    setTimeout(pop, 3800+Math.random()*2200); };
  setTimeout(pop, 1600);
}
function heroFit(){ const hero=$('[data-framer-name="Hero"]'); const content=hero&&$('[data-framer-name="Content"]',hero); const pill=hero&&$('[data-framer-name="Label"]',hero); const btn=hero&&$('[data-framer-name="Buttons"]',hero); const imgc=hero&&hero.querySelector('.framer-aqtgzr'); if(!hero||!content||!pill||!btn||!imgc) return;
  const vh=innerHeight; const heroTop=hero.getBoundingClientRect().top+scrollY;
  const targetPill=innerWidth<700?110:Math.round(vh*0.19);
  const curPT=parseFloat(getComputedStyle(content).paddingTop)||0; const pillTop=pill.getBoundingClientRect().top+scrollY-heroTop;
  const newPT=Math.max(24,Math.round(curPT+(targetPill-pillTop))); content.style.setProperty('padding-top',newPT+'px','important');
  const btnBottom=btn.getBoundingClientRect().bottom+scrollY-heroTop; const contTop=$('[data-framer-name="Container"]',hero).getBoundingClientRect().top+scrollY-heroTop;
  imgc.style.setProperty('--sb-imgtop',Math.round(btnBottom-contTop-(innerWidth<700?0:36))+'px');
  if(!document.body.classList.contains('sb-ready')) setTimeout(()=>document.body.classList.add('sb-ready'),250); }
function heroParallax(){ const imgc=document.querySelector('.framer-aqtgzr'); if(imgc) imgc.style.setProperty('--sb-par',Math.round(Math.min(scrollY,innerHeight)*0.08)+'px'); }
addEventListener('resize',()=>heroFit()); addEventListener('scroll',heroParallax,{passive:true});
function stats(){
  const c=$('[data-framer-name="Logo Section"] [data-framer-name="Container"]'); if(!c||$('#sb-stats',c)) return;
  c.appendChild(el(`<div id="sb-stats" class="sb-stats"><p class="t">What desks running Soba got back in the last 90 days</p><div><b>$5M</b><span>Volume transacted</span></div><div><b>1,500</b><span>Orders taken</span></div><div><b>600 hrs</b><span>Saved for sales desks</span></div></div>`));
  [['rgba(0,153,255,.45)','14%'],['rgba(255,169,0,.4)','72%']].forEach(([col,l])=>{ const s=el('<div class="sb-splotch"></div>'); s.style.cssText=`position:absolute;left:${l};top:50%;transform:translateY(-50%);width:170px;height:170px;z-index:0;filter:blur(26px);opacity:.4;mix-blend-mode:multiply;border-radius:50%;pointer-events:none;background:radial-gradient(circle, ${col} 0%, rgba(255,255,255,0) 68%)`; c.appendChild(s); });
}
function footer(){
  const hd=$('[data-framer-name="Footer"] [data-framer-name="Header"], footer [data-framer-name="Header"]'); if(!hd||$('#sb-contact',hd)) return;
  // hide the social icon row: the last child block that contains 4 small links/icons
  [...hd.children].forEach(ch=>{ if(ch.querySelectorAll('a').length>=3 && ch.getBoundingClientRect().height<60) ch.style.display='none'; });
  hd.appendChild(el(`<div id="sb-contact" class="sb-contact">
    <a href="mailto:hello@usesoba.com" title="hello@usesoba.com" aria-label="Email">${icon.mail}</a>
    <a href="sms:+14808198035" title="Text 480 819 8035" aria-label="Text">${icon.sms}</a>
    <a href="tel:+14808198035" title="Call 480 819 8035" aria-label="Call">${icon.phone}</a></div>`));
}
function heroImage(){ document.querySelectorAll('img[src*="epYjC31"],img[srcset*="epYjC31"]').forEach(im=>{ im.removeAttribute('srcset'); im.removeAttribute('sizes'); im.src='img/hero.webp'; }); document.querySelectorAll('img[src*="D8cPRFjF76"],img[srcset*="D8cPRFjF76"]').forEach(im=>{ im.removeAttribute('srcset'); im.removeAttribute('sizes'); im.src='img/hero.webp'; }); document.querySelectorAll('img[src*="Pai7r7Udk"],img[srcset*="Pai7r7Udk"]').forEach(im=>{ im.removeAttribute('srcset'); im.removeAttribute('sizes'); im.src='img/cta.jpg?v=3'; }); }
function links(){
  const sec=(n,id)=>{const e=document.querySelector('[data-framer-name="'+n+'"]'); if(e&&!e.id) e.id=id;};
  sec('Feature Section','how'); sec('Demo Section','demo'); sec('Integration Section','setup'); sec('Solutions Section','solution');
  const CAL='https://calendar.app.google/pWPid79eAXuna1nh8'; const onHome=window.SB_PAGE!=='contact'; const H=onHome?'':'/';
  const MAPL={'How it works':H+'#how','Set up':H+'#setup','Solution':H+'#solution','Contact us':'/contact','Home':onHome?'#':'/','soba':onHome?'#':'/','Book a demo':CAL,'Pick a time':CAL,'Ask a question':'/contact','Contact':'/contact','Send an email':'mailto:hello@usesoba.com','Text us':'sms:+14808198035','Call us':'tel:+14808198035','Privacy':'/privacy','Terms':'/terms'};
  document.querySelectorAll('a').forEach(a=>{ const t=a.textContent.replace(/\s+/g,' ').trim(); const key=Object.keys(MAPL).find(k=>t===k||t===k+' '+k||t===k+k); const href=a.getAttribute('href')||'';
    if(key){ if(a.getAttribute('href')!==MAPL[key]) a.setAttribute('href',MAPL[key]); if(/^https:/.test(MAPL[key])){ a.setAttribute('target','_blank'); a.setAttribute('rel','noopener'); }
      if(!/^#/.test(MAPL[key]) && !a.dataset.sbx){ a.dataset.sbx='1'; a.addEventListener('click',ev=>{ ev.stopPropagation(); },true); } }
    else if(/lunisdesign|framer\.com|nexura/i.test(href)) a.removeAttribute('href');
    if(/^#/.test(a.getAttribute('href')||'') && !a.dataset.sb){ a.dataset.sb='1'; a.addEventListener('click',ev=>{ const id=a.getAttribute('href').slice(1); const el=id&&document.getElementById(id); if(el){ ev.preventDefault(); ev.stopPropagation(); const y=el.getBoundingClientRect().top+scrollY-80; window.scrollTo({top:y,behavior:'smooth'}); } else if(!id){ ev.preventDefault(); window.scrollTo({top:0,behavior:'smooth'}); } },true); }
  });
}

/* ---- chips (Ruben/Marisol) that survive the Cursor hide ---- */
function chips(){ document.querySelectorAll('p').forEach(p=>{ if(/^(Ruben|Marisol)$/.test(p.textContent.trim())){ let x=p; for(let i=0;i<6&&x.parentElement;i++){ x=x.parentElement; if(getComputedStyle(x).position==='absolute'){ x.style.display='none'; break; } } } }); }
/* ---- section 1: rotating features with matching mocks ---- */
const MOCKS=[
 `<div class="v v-call"><div class="who"><div class="av">FV</div><b>Fresh Valley Produce</b><small>Soba answering · 11:47 PM</small></div><div class="wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="lines"><div class="ln b">Necesito 320 cajas de roma grande para el jueves.</div><div class="ln s">320 cases Roma large, pickup Thursday, $22.00. Confirmed, #S-20481.</div><div class="ln b">Perfecto, gracias.</div></div></div>`,
 `<div class="v v-sheet"><div class="req"><span class="who">Fresh Valley</span>Roma large · 320 cs · <b>$22.00</b></div><div class="sheet"><div class="hd"><span>Tonight's sheet</span><span>Tue Nov 3</span></div><div class="rw"><span>Super cucumber</span><span>$18.00</span></div><div class="rw hit"><span>Roma large</span><span>$22.00</span><em>Cleared · #S-20481</em></div><div class="rw"><span>Bell pepper</span><span>$16.50</span></div></div></div>`,
 `<div class="v v-wa"><div class="hd"><span class="av">${CL('#075E54',18)}</span>Soba · to Marisol</div><div class="msg"><b>Rio Bravo wants 200 cs cucumber at $17.00</b>Your rule says $18.00. Approve?</div><div class="acts"><span class="go">Approve</span><span>Counter</span></div></div>`,
 `<div class="v v-mail"><div class="top"><div class="from">Soba · 6:45 AM · 15 min before opening</div><div class="subj"><i class="sun"></i>Good morning. 11 orders came in overnight.</div></div><div class="nums"><div class="b"><b>11</b><span>orders</span></div><div class="g"><b>$41K</b><span>volume</span></div><div class="o"><b>2</b><span>waiting on you</span></div></div><div class="cards"><i class="b"><b>Fresh Valley</b>Roma · 320 cs</i><i class="g"><b>Valle Verde</b>Pepper · 480 cs</i><i class="o"><b>Del Norte</b>Mango · 180 cs</i></div></div>`];
const FICONS=['<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>','<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M20 12l-8 8-9-9V3h8l9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>','<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h10M7 14h6"/></svg>','<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'];
const FEATS=[['Voice and text desk','Answers calls and texts after close, in English or Spanish. Reads every number back before anything is confirmed.'],['Price rule clearing','Checks each request against tonight\'s sheet and volume limits. Inside the rules, it\'s confirmed on the call with a reference number.'],['WhatsApp updates to reps','Anything outside the rules goes to your on-call reps: Approve, Counter, Reject or Take over. First to answer decides.'],['Morning summary','Fifteen minutes before opening: what was won, what\'s waiting, every transcript, and the order cards.']];
function feature(){
  const c=$('[data-framer-name="Feature Section"] [data-framer-name="Container"]'); if(!c||$('#sb-feat',c)) return;
  const f=el(`<div id="sb-feat" class="sb-feat"><div class="head"><h2>Stop losing sales to missed calls.</h2><p>Soba takes the order, checks your prices and writes it up before anyone's in.</p></div>
    <div class="grid"><div class="stage">${MOCKS.map((m,i)=>`<div class="mock" data-i="${i}">${m}</div>`).join('')}</div>
    <div class="list">${FEATS.map((x,i)=>`<div class="it" data-i="${i}"><h4><i>${FICONS[i]}</i>${x[0]}</h4><div class="d"><p>${x[1]}</p></div></div>`).join('')}</div></div></div>`);
  c.appendChild(f);
  let cur=0, timer; const set=i=>{ cur=i; f.querySelectorAll('.mock').forEach(m=>m.classList.toggle('on', +m.dataset.i===i)); f.querySelectorAll('.it').forEach(it=>{ it.classList.remove('on'); void it.offsetWidth; it.classList.toggle('on', +it.dataset.i===i); }); };
  const loop=()=>{ clearTimeout(timer); timer=setTimeout(()=>{ set((cur+1)%4); loop(); }, 6600); };
  f.querySelectorAll('.it').forEach(it=>it.addEventListener('click',()=>{ set(+it.dataset.i); loop(); }));
  set(0); loop();
}
/* ---- screen section: three product panes inside a framed screen, pinned at center ---- */
const ORDERS=[['11:52 PM','Fresh Valley','Roma 5x6 · 320 cs','$4,640','ok','Confirmed'],['12:20 AM','Sun Coast','Limes 175 ct · 150 cs','$2,250','ok','Confirmed'],['1:08 AM','Rio Bravo','Super cucumber · 200 cs','$3,600','r','Rep approved'],['1:41 AM','Mercado Norte','Squash · 260 cs','$3,120','ok','Confirmed'],['2:31 AM','Valle Verde','Bell pepper · 480 cs','$7,920','ok','Confirmed'],['3:05 AM','La Costeña','Roma 4x4 · 300 cs','$4,500','w','Waiting on rep'],['4:15 AM','Agro Baja','Cucumber · 240 cs','$4,320','ok','Confirmed'],['5:40 AM','Del Norte','Mango · 180 cs','$3,960','ok','Confirmed']];
function screen(){
  const c=$('[data-framer-name="Demo Section"] [data-framer-name="Container"]'); if(!c||$('#sb-screen',c)) return;
  const side=(on)=>`<div class="side"><div class="brand">${CL('#0B1A2B',20)} soba</div>${['Tonight','Requests','Price sheet','Buyers','Reps','Conversations'].map(x=>`<a class="${x===on?'on':''}">${x}</a>`).join('')}</div>`;
  const pane1=`<div class="pane on" data-i="0">${side('Tonight')}<div class="mainp"><h3>Tonight · Nogales desk</h3><div class="sub">Line forwarded at 5:30 PM · Soba answering · 8 requests</div>
    <div class="kpis"><div class="kpi"><span>Orders confirmed</span><b>7</b></div><div class="kpi"><span>Volume</span><b>$29,810</b></div><div class="kpi"><span>Waiting on a rep</span><b>1</b></div><div class="kpi"><span>Avg. answer</span><b>3 rings</b></div></div>
    <table><thead><tr><th>Time</th><th>Buyer</th><th>Order</th><th>Value</th><th>Status</th></tr></thead><tbody>${ORDERS.map(o=>`<tr><td>${o[0]}</td><td>${o[1]}</td><td>${o[2]}</td><td>${o[3]}</td><td><span class="st ${o[4]}">${o[5]}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  const pane2=`<div class="pane" data-i="1">${side('Price sheet')}<div class="mainp"><h3>Desk controls</h3><div class="sub">What Soba may confirm on its own tonight</div>
    <div class="cols"><div class="card"><h4>Tonight's price sheet</h4>
      <div class="row"><span>Roma 5x6 · 25 lb</span><span><b>$14.00</b> · min 100 · max 600 cs</span></div><div class="row"><span>Super cucumber</span><span><b>$18.00</b> · min 50 · max 400 cs</span></div><div class="row"><span>Bell pepper · XL</span><span><b>$16.50</b> · min 80 · max 500 cs</span></div><div class="row"><span>Limes 175 ct</span><span><b>$15.00</b> · min 50 · max 300 cs</span></div><div class="row"><span>Squash · medium</span><span><b>$12.00</b> · min 60 · max 400 cs</span></div></div>
      <div class="card"><h4>Permissions</h4>
      <div class="row"><span>Auto-confirm inside the sheet</span><span class="tg"></span></div><div class="row"><span>Counter up to 3% below sheet</span><span class="tg"></span></div><div class="row"><span>Confirm new buyers without a rep</span><span class="tg off"></span></div><div class="row"><span>Take orders in Spanish</span><span class="tg"></span></div><div class="row"><span>Record calls</span><span class="tg"></span></div>
      <h4 style="margin-top:14px">On-call reps</h4><div><span class="chip">Marisol G.</span><span class="chip">Ruben P.</span><span class="chip">+ add</span></div>
      <h4 style="margin-top:14px">Hours</h4><div class="row"><span>Soba answers</span><span><b>5:30 PM – 6:30 AM</b> · after 4 rings</span></div></div></div></div></div>`;
  const pane3=`<div class="pane" data-i="2">${side('Conversations')}<div class="mainp"><div class="msgs"><div class="threads">
      ${[['Fresh Valley','11:52 PM','Confirmed · 320 cs Roma 5x6',1],['Sun Coast','12:20 AM','Confirmed · 150 cs limes',0],['Rio Bravo','1:08 AM','Rep approved · 200 cs cucumber',0],['Mercado Norte','1:41 AM','Confirmed · 260 cs squash',0],['Valle Verde','2:31 AM','Confirmed · 480 cs bell pepper',0],['La Costeña','3:05 AM','Waiting on rep · 300 cs Roma 4x4',0],['Agro Baja','4:15 AM','Confirmed · 240 cs cucumber',0]].map(x=>`<div class="th ${x[3]?'on':''}"><b>${x[0]}<small>${x[1]}</small></b><span>${x[2]}</span></div>`).join('')}</div>
      <div class="thread"><div class="hd">Fresh Valley · call · 11:49 PM · Spanish, transcribed</div>
      <div class="bub b">Necesito 320 cajas de roma 5x6 para el jueves, a catorce cincuenta.</div>
      <div class="bub s">320 cases Roma 5x6, pickup Thursday, FOB Nogales, at $14.50. Let me read that back and check it against tonight's sheet.</div>
      <div class="bub b">Sí, correcto.</div>
      <div class="bub s">Confirmed. Order S-20481, 320 cases Roma 5x6 at $14.50, pickup Thursday. I'm texting you the written confirmation now.<span class="tr">Confirmed inside the price sheet · 11:52 PM</span></div>
      <div class="bub b">Gracias.</div></div></div></div></div>`;
  const d=el(`<div id="sb-screen" class="sb-screen"><div class="bg"></div><div class="sticky"><div class="cap"></div><div class="frame" style="position:relative">${pane1}${pane2}${pane3}</div><div class="dots"><i class="on"></i><i></i><i></i></div></div></div>`);
  c.appendChild(d);
  const caps=['Everything sold overnight, in one place','You set the prices, limits and permissions','Every conversation, written down'];
  const update=()=>{ const r=d.getBoundingClientRect(); const total=r.height-680; const p=Math.min(.999,Math.max(0,(-r.top+(innerHeight-680)/2)/total)); const i=Math.floor(p*3);
    d.querySelectorAll('.pane').forEach(pn=>pn.classList.toggle('on',+pn.dataset.i===i)); d.querySelectorAll('.dots i').forEach((x,k)=>x.classList.toggle('on',k===i)); d.querySelector('.cap').textContent=caps[i]; };
  addEventListener('scroll',update,{passive:true}); update();
}
/* ---- integration hub ---- */
function hub(){
  const c=$('[data-framer-name="Integration Section"] [data-framer-name="Canvas"]'); if(!c||$('#sb-hub',c)) return;
  const nodes=[['WhatsApp',90,'#25D366',icon.wa],['Phone line',162,'#0B1A2B',icon.phone],['SMS',234,'#0099FF',icon.sms],['Email',306,'#F82705',icon.mail],['Your ERP',18,'#7A5AF8','<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>']];
  const cx=275,cy=275,R=216; const pos=a=>[cx+R*Math.cos(a*Math.PI/180), cy+R*Math.sin(a*Math.PI/180)];
  let svg=`<svg viewBox="0 0 550 550"><defs><pattern id="sbg" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#e6e6e6"/></pattern></defs><rect width="550" height="550" fill="url(#sbg)"/>`;
  nodes.forEach((n,i)=>{ const [x,y]=pos(n[1]); const id='sbp'+i; svg+=`<path id="${id}" d="M${x} ${y} L${cx} ${cy}" stroke="#dcdcdc" stroke-width="2" fill="none"/>
    <circle r="5" fill="#1DA462"><animateMotion dur="${2.6+i*.35}s" repeatCount="indefinite" begin="${i*.5}s"><mpath href="#${id}"/></animateMotion></circle>
    <g class="tile" transform="translate(${x-36} ${y-36})"><rect width="72" height="72" rx="20" fill="${n[2]}"/><g transform="translate(18 18) scale(1.5)" ${/fill="#fff"/.test(n[3].slice(0,80))?'fill="#fff"':'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${n[3].replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</g></g>
    <text class="node" x="${x}" y="${y+52}" text-anchor="middle">${n[0]}</text>`; });
  svg+=`<circle cx="${cx}" cy="${cy}" r="64" fill="#fff" stroke="#e6e6e6" stroke-width="2"/><g transform="translate(${cx-40} ${cy-40})">${CL('#0B1A2B',80)}</g></svg>`;
  c.appendChild(el(`<div id="sb-hub" class="sb-hub">${svg}</div>`));
}
/* ---- solutions: stacked value rows ---- */
function rows(){
  const c=$('[data-framer-name="Solutions Section"] .framer-1amiabt'); if(!c||$('#sb-rows',c)) return;
  const R=[['Same-day sales','Stop finding out about Thursday\'s loads on Friday.','Soba takes the night orders and has the cards ready before the desk opens.',
    `<div class="g-stack" data-stack></div>`],
   ['Higher prices','Sell your inventory on time, at higher prices.','Night orders clear at tonight\'s sheet, not at the morning\'s discount. Soba holds your price and moves the product before it ages.',
    `<div class="g-pricewrap"><div class="g-price"><div class="row"><div class="lab">Tomorrow morning discount<b>Roma large · 320 cs</b></div><div class="num cut">$19.00<small>/cs</small></div></div><div class="row"><div class="lab">Tonight's sheet<b>Sold at 11:52 PM</b></div><div class="num win">$22.00<small>/cs</small><svg viewBox="0 0 140 60" preserveAspectRatio="none"><ellipse cx="70" cy="30" rx="66" ry="26"/></svg></div></div></div><div class="g-profit"><b>+$960</b>more on this order</div></div>`],
   ['One desk','Manage every buyer from one desk.','Written confirmations and a morning summary, without the manual overhead.',
    `<div class="g-desk"><div class="map"><svg class="mapsvg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet"><path d="M-10 60 C40 20 90 70 140 40 S200 50 210 30 L210 -10 L-10 -10Z" fill="#DFF0E3"/><path d="M-10 230 C40 200 70 260 120 230 S180 250 210 220 L210 310 L-10 310Z" fill="#DFF0E3"/><g stroke="#9CC9A6" stroke-width="1.6" stroke-dasharray="3 6" fill="none"><path d="M44 232 Q70 190 100 150"/><path d="M156 92 Q130 120 100 150"/><path d="M46 70 Q75 110 100 150"/></g><circle cx="44" cy="232" r="7" fill="#0099FF"/><circle cx="44" cy="232" r="3" fill="#fff"/><circle class="ring" cx="44" cy="232" r="7" fill="none" stroke="#0099FF" stroke-width="2"/><text x="57" y="236" font-size="11" font-weight="600" fill="#1b2b1f" text-anchor="start" font-family="Inter,sans-serif">Nogales</text><circle cx="156" cy="92" r="7" fill="#1DA462"/><circle cx="156" cy="92" r="3" fill="#fff"/><circle class="ring" cx="156" cy="92" r="7" fill="none" stroke="#1DA462" stroke-width="2"/><text x="143" y="96" font-size="11" font-weight="600" fill="#1b2b1f" text-anchor="end" font-family="Inter,sans-serif">Valley</text><circle cx="46" cy="70" r="7" fill="#F59E0B"/><circle cx="46" cy="70" r="3" fill="#fff"/><circle class="ring" cx="46" cy="70" r="7" fill="none" stroke="#F59E0B" stroke-width="2"/><text x="59" y="74" font-size="11" font-weight="600" fill="#1b2b1f" text-anchor="start" font-family="Inter,sans-serif">Salinas</text><circle cx="100" cy="150" r="17" fill="#0B1A2B"/><g transform="translate(90 140) scale(0.83)">${CL('#fff',24)}</g><text x="100" y="184" font-size="11" font-weight="600" fill="#1b2b1f" text-anchor="middle" font-family="Inter,sans-serif">Your desk</text></svg></div><div class="list"><h5>Tonight<small>3 buyers · $18,960</small></h5><div class="b" style="animation-delay:0s"><i></i><div><b>Fresh Valley</b><span>Nogales · 320 cs</span></div><em>$7,040</em></div><div class="g" style="animation-delay:2s"><i></i><div><b>Rio Bravo</b><span>Valley · 200 cs</span></div><em>$4,000</em></div><div class="o" style="animation-delay:4s"><i></i><div><b>Valle Verde</b><span>Salinas · 480 cs</span></div><em>$7,920</em></div></div></div>`]];
  const w=el(`<div id="sb-rows" class="sb-rows"><div class="labels">${R.map((r,i)=>`<a data-i="${i}" class="${i?'':'on'}">${r[0]}</a>`).join('')}</div><div class="right">${R.map((r,i)=>`<div class="sb-row" data-i="${i}"><div><h3>${r[1]}</h3><p>${r[2]}</p></div><div class="gfx">${r[3]}</div></div>`).join('')}</div></div>`);
  c.appendChild(w);
  const st=w.querySelector('[data-stack]'); if(st){ const N=[['Fresh Valley','$7,040','Roma large · 320 cs · 11:52 PM'],['Rio Bravo','$4,000','Super cucumber · 200 cs · 1:08 AM'],['Valle Verde','$7,920','Bell pepper · 480 cs · 2:31 AM'],['Del Norte','$3,960','Mango · 180 cs · 5:40 AM'],['Sun Harvest','$2,880','Limes · 160 cs · 3:15 AM']]; let k=0; const cards=[];
    const push=()=>{ const n=N[k++%N.length]; const d=el(`<div class="c new"><b>${n[0]}<small>${n[1]}</small></b><span>${n[2]}</span></div>`); st.appendChild(d); cards.unshift(d); requestAnimationFrame(()=>requestAnimationFrame(()=>{ cards.forEach((x,i)=>{ x.className='c'+(i?' l'+Math.min(i,4):' top'); }); })); while(cards.length>5){ cards.pop().remove(); } };
    push(); setInterval(push,2600); }
  const rowsEls=[...w.querySelectorAll('.sb-row')], labels=[...w.querySelectorAll('.labels a')];
  const mark=()=>{ const mid=innerHeight*0.5; let best=0,bd=1e9; rowsEls.forEach((r,i)=>{ const b=r.getBoundingClientRect(); const d=Math.abs((b.top+b.bottom)/2-mid); if(d<bd){bd=d;best=i;} }); labels.forEach((l,i)=>l.classList.toggle('on',i===best)); };
  addEventListener('scroll',mark,{passive:true}); mark();
  labels.forEach(l=>l.addEventListener('click',()=>{ const r=rowsEls[+l.dataset.i]; window.scrollTo({top:r.getBoundingClientRect().top+scrollY-innerHeight*0.5+r.getBoundingClientRect().height/2,behavior:'smooth'}); }));
}
function scrolled(){ document.body.classList.toggle('sb-scrolled', scrollY>innerHeight*0.85); }
/* ---- nav: a Contact us item cloned from the Solution slot (desktop nav + phone menu) ---- */
function navContact(){
  const fix=c=>{ const a=c.querySelector('a'); const p=c.querySelector('a .framer-text'); if(!a||!p) return false; if(a.getAttribute('href')!=='/contact'){ a.setAttribute('href','/contact'); a.removeAttribute('target'); delete a.dataset.sb; delete a.dataset.sbx; } if(p.textContent.trim()!=='Contact us') p.textContent='Contact us'; return true; };
  document.querySelectorAll('.sb-nav-contact').forEach(fix);
  ['.framer-2pvb77-container','.framer-1b06bnt-container'].forEach(sel=>document.querySelectorAll(sel+':not(.sb-nav-contact)').forEach(slot=>{
    const par=slot.parentElement; if(!par||par.querySelector('.sb-nav-contact')) return;
    if(!slot.querySelector('a .framer-text')) return; // Framer has not rendered the link yet; a later run will
    const c=slot.cloneNode(true); c.classList.add('sb-nav-contact'); c.removeAttribute('style');
    if(fix(c)) par.insertBefore(c, slot.nextSibling);
  }));
}
/* ---- footer columns: Soba = Home / How it works / Solution; Company = Book a demo / Contact us ---- */
function footerCols(){
  const set=(sel,text)=>document.querySelectorAll(sel).forEach(c=>{ const p=c.querySelector('p'); if(p&&p.textContent.trim()!==text) p.textContent=text; });
  set('.framer-n611z5-container','Book a demo'); set('.framer-4pmyip-container','Contact us');
}
/* ---- legal pages: the article lives in a <template>; Framer's client render drops it, so put it back before the (hidden) form section ---- */
function legal(){ const tpl=document.getElementById('sb-legal-src'); if(!tpl||document.getElementById('sb-legal')) return; const fs=document.querySelector('[data-framer-name="Form Section"]'); if(!fs) return; const sec=document.createElement('section'); sec.id='sb-legal'; sec.className='sb-legal'; sec.innerHTML=tpl.innerHTML; fs.parentNode.insertBefore(sec, fs); }
/* ---- contact cards: the third card gets a second link, Call us ---- */
function contactCards(){
  document.querySelectorAll('a').forEach(a=>{ if(a.textContent.trim()!=='Text us'||a.parentElement.querySelector('.sb-call')) return;
    const c=a.cloneNode(true); c.classList.add('sb-call'); c.setAttribute('href','tel:+14808198035'); delete c.dataset.sbx; c.textContent='Call us';
    a.after(document.createTextNode('\u00a0\u00a0\u00b7\u00a0\u00a0'), c); });
}
/* ---- contact form: posts to the app, which mails hello@usesoba.com ---- */
function contactForm(){
  const f=document.querySelector('form[data-framer-form]'); if(!f) return;
  const ph={Name:'Your name',Email:'you@company.com'}; f.querySelectorAll('input[name="Name"],input[name="Email"]').forEach(i=>{ if(i.placeholder!==ph[i.name]) i.placeholder=ph[i.name]; });
  const ta=f.querySelector('textarea'); if(ta&&ta.placeholder!=='Products, markets, volume. Anything.') ta.placeholder='Products, markets, volume. Anything.';
  if(f.dataset.sb) return; f.dataset.sb='1';
  f.addEventListener('submit',async ev=>{
    ev.preventDefault(); ev.stopPropagation();
    const v=n=>{ const e=f.querySelector('[name="'+n+'"]'); if(!e) return ''; if(e.tagName==='SELECT'){ const o=e.options[e.selectedIndex]; return o&&!o.disabled?o.textContent.trim():''; } return e.value.trim(); };
    const data={name:v('Name'),email:v('Email'),kind:v('What best describes you?'),orders:v('Where are you in your journey?'),message:v('Message'),website:v('website'),company:v('company')};
    if(!data.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){ (data.name?f.querySelector('[name="Email"]'):f.querySelector('[name="Name"]')).focus(); return; }
    const btn=f.querySelector('button,input[type=submit]'); const label=btn&&btn.textContent; if(btn){ btn.disabled=true; btn.style.opacity='.6'; }
    let ok=false; try{ const r=await fetch('https://app.usesoba.com/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}); ok=r.ok; }catch(e){ ok=false; }
    if(ok){ f.innerHTML='<div class="sb-sent"><b>Got it.</b> We reply within one business day.</div>'; }
    else { if(btn){ btn.disabled=false; btn.style.opacity=''; } location.href='mailto:hello@usesoba.com?subject='+encodeURIComponent('Soba: '+data.name)+'&body='+encodeURIComponent([data.name,data.email,data.kind,data.orders,'',data.message].join('\n')); }
  },true);
}
function all(){ try{ heroImage(); chips(); hero(); heroFit(); stats(); footer(); footerCols(); navContact(); legal(); contactCards(); contactForm(); links(); feature(); hub(); rows(); if(document.readyState==='complete') splotches(); }catch(e){ console.warn('soba layer', e); } }
window.sobaLayer=all;
/* Framer 'appear' sometimes never fires for a variant (seen on the contact page's phone layout): after load, reveal anything still at its pre-animation opacity inside the viewport. Below-the-fold scroll reveals stay as they are. */
function appearFallback(){ document.querySelectorAll('[style*="opacity: 0.001"],[style*="opacity:0.001"]').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.bottom>0&&r.top<innerHeight&&r.width>0&&parseFloat(getComputedStyle(e).opacity)<0.01){ e.style.opacity='1'; e.style.transform='none'; } }); }
window.addEventListener('load',()=>{ setTimeout(appearFallback,2500); setTimeout(appearFallback,5000); });
addEventListener('scroll',scrolled,{passive:true}); scrolled();
addEventListener('load',()=>{ all(); setTimeout(all,900); setTimeout(all,2500); });
if(document.readyState==='complete') all();
})();
