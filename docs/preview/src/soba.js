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
function heroFit(){ const hero=$('[data-framer-name="Hero"]'); const content=hero&&$('[data-framer-name="Content"]',hero); const pill=hero&&$('[data-framer-name="Label"]',hero); const btn=hero&&$('[data-framer-name="Buttons"]',hero); const imgc=hero&&hero.querySelector('.framer-aqtgzr'); if(!hero||!content||!pill||!btn||!imgc) return;
  const vh=innerHeight; const heroTop=hero.getBoundingClientRect().top+scrollY;
  const targetPill=innerWidth<700?110:Math.round(vh*0.19);
  const curPT=parseFloat(getComputedStyle(content).paddingTop)||0; const pillTop=pill.getBoundingClientRect().top+scrollY-heroTop;
  const newPT=Math.max(24,Math.round(curPT+(targetPill-pillTop))); content.style.setProperty('padding-top',newPT+'px','important');
  const btnBottom=(document.getElementById('sb-first-version')||btn).getBoundingClientRect().bottom+scrollY-heroTop; const contTop=$('[data-framer-name="Container"]',hero).getBoundingClientRect().top+scrollY-heroTop;
  hero.querySelectorAll('.framer-aqtgzr').forEach(image=>image.style.setProperty('--sb-imgtop',Math.round(btnBottom-contTop+24)+'px'));
  if(!document.body.classList.contains('sb-ready')) setTimeout(()=>{ document.body.classList.add('sb-ready'); setTimeout(()=>document.body.classList.add('sb-live'),1300); },250); }
function heroParallax(){ const imgc=document.querySelector('.framer-aqtgzr'); if(imgc) imgc.style.setProperty('--sb-par',(Math.min(scrollY,innerHeight)*0.08).toFixed(2)+'px'); }
addEventListener('resize',()=>heroFit()); addEventListener('scroll',heroParallax,{passive:true});
const sbSet=im=>{ const src='img/distribution-warehouse.webp'; if(im.getAttribute('src')!==src){ im.removeAttribute('srcset'); im.src=src; } im.alt='Shelves of boxed inventory in a distribution warehouse'; };
function heroImage(){ document.querySelectorAll('img[src*="distribution-warehouse"],img[src*="epYjC31"],img[srcset*="epYjC31"],img[src*="D8cPRFjF76"],img[srcset*="D8cPRFjF76"]').forEach(im=>{ sbSet(im,'hero'); im.setAttribute('fetchpriority','high'); }); document.querySelectorAll('img[src*="Pai7r7Udk"],img[srcset*="Pai7r7Udk"]').forEach(im=>sbSet(im,'cta')); }

const EMAIL='mailto:trustin@usesoba.com?subject=A%20workflow%20for%20our%20team';
function links(){
  const home=window.SB_PAGE==='home'; const base=home?'':'/';
  const map={'What we build':base+'#how','How we work':base+'#setup','How it works':base+'#how','Home':home?'#':'/','soba':home?'#':'/','See examples':base+'#how','Talk to us':EMAIL,'Contact us':EMAIL,'Contact':EMAIL,'Send an email':EMAIL,'Book a demo':EMAIL,'Pick a time':EMAIL,'Privacy':'/privacy','Terms':'/terms'};
  document.querySelectorAll('a').forEach(a=>{
    const t=a.textContent.replace(/\s+/g,' ').trim(); const key=Object.keys(map).find(k=>t===k||t===k+' '+k||t===k+k);
    if(key){ if(a.getAttribute('href')!==map[key]) a.setAttribute('href',map[key]); a.removeAttribute('target'); }
    if(/lunisdesign\.com/.test(a.getAttribute('href')||''))a.removeAttribute('href');
    if(/^https:\/\/(x|linkedin|youtube|github)\.com\/?$/.test(a.getAttribute('href')||'')){a.removeAttribute('href');a.style.display='none';}
    if(/^(mailto:|tel:|sms:)/.test(a.getAttribute('href')||'')&&!a.dataset.sbEmail){a.dataset.sbEmail='1';a.addEventListener('click',e=>e.stopPropagation(),true);}
  });
}
function content(){
  document.querySelectorAll('nav [data-framer-name="Control"]').forEach(c=>{if(!c.querySelector('.sb-mobile-cta'))c.append(el('<a class="sb-mobile-cta" href="'+EMAIL+'">Talk to us</a>'));});
  ['Demo Section','Logo Section','Solutions Section','Testimonial Section','Pricing Section'].forEach(n=>document.querySelectorAll('[data-framer-name="'+n+'"]').forEach(e=>e.remove()));
  const feat=$('[data-framer-name="Feature Section"]'); if(feat){feat.id='how'; const c=$('[data-framer-name="Container"]',feat);if(c&&!$('#sb-feat',c))c.replaceChildren($('#sb-use-cases-template').content.cloneNode(true));}
  const setup=$('[data-framer-name="Integration Section"]'); if(setup){setup.id='setup'; const c=$('[data-framer-name="Canvas"]',setup);if(c&&!$('#sb-workflow',c))c.replaceChildren($('#sb-workflow-template').content.cloneNode(true));}
  const buttons=$('[data-framer-name="Hero"] [data-framer-name="Buttons"]');if(buttons&&!$('#sb-first-version'))buttons.after(el('<p id="sb-first-version" class="sb-first-version">Start with one workflow. We’ll build the first version free.</p>'));
  const hero=$('[data-framer-name="Hero"]');if(hero){const h=$('h1',hero);if(h&&!h.querySelector('[data-soba-heading]'))h.innerHTML='<span data-soba-heading>More time selling.</span> <span data-soba-heading>Less time on busywork.</span>';const label=$('[data-framer-name="Label"]',hero);if(label&&label.textContent!=='AI for distributors')label.textContent='AI for distributors';}
  document.querySelectorAll('.framer-2pvb77-container,.framer-1b06bnt-container').forEach(e=>e.style.display='none');
  document.querySelectorAll('footer a,[data-framer-name="Footer"] a').forEach(a=>{if(/Outcomes|Solution/.test(a.textContent)&&a.textContent.trim()!=='Practical AI for distributors.')a.closest('[class*="-container"]')?.remove();});
  document.querySelectorAll('[data-framer-name="Footer"] [data-framer-name="Header"],footer [data-framer-name="Header"]').forEach(footer=>{if(footer.querySelector('[data-framer-name="Header"]'))return;if(!$('.sb-email-contact',footer))footer.append(el('<div class="sb-email-contact"><a href="'+EMAIL+'">trustin@usesoba.com ↗</a></div>'));});
}
function legal(){ const tpl=document.getElementById('sb-legal-src'); if(!tpl||document.getElementById('sb-legal')) return; const fs=document.querySelector('[data-framer-name="Form Section"]'); if(!fs) return; const sec=document.createElement('section'); sec.id='sb-legal'; sec.className='sb-legal'; sec.innerHTML=tpl.innerHTML; fs.parentNode.insertBefore(sec, fs); }
function contact(){
  if(window.SB_PAGE!=='contact')return;
  document.querySelectorAll('[data-framer-name="Info Section"],[data-framer-name="FAQ Section"]').forEach(e=>e.remove());
  const form=$('form[data-framer-form]'); if(form)form.replaceWith(el('<div class="sb-contact-simple"><h2>Start with one workflow.</h2><p>Tell us where your team gets bogged down. We’ll build the first version free.</p><a href="'+EMAIL+'">Email trustin@usesoba.com ↗</a></div>'));
}
function scrolled(){document.body.classList.toggle('sb-scrolled',scrollY>innerHeight*.85);}
function all(){try{heroImage();content();legal();contact();links();heroFit();}catch(e){console.warn('soba layer',e);}}
window.sobaLayer=all;
addEventListener('scroll',scrolled,{passive:true});scrolled();
addEventListener('load',()=>{all();});
if(document.readyState!=='loading')all();else document.addEventListener('DOMContentLoaded',all);
})();
