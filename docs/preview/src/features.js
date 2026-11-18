function feature() {
  const container = $('[data-framer-name="Feature Section"] [data-framer-name="Container"]');
  if (!container || $('#sb-feat', container)) return;

  const workflows = [
    {
      title: 'Find sales opportunities',
      description: 'Turn a manufacturer’s product launch into a reason to reach out. Find the buyer and prepare an Outlook draft your rep can edit and send.',
      icon: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
      visual: `
        <div class="v v-bd">
          <div class="top"><div class="from">Outbound prospecting</div><div class="subj">Alder Ridge Tools</div></div>
          <div class="rows">
            <div class="r"><div><b>New 18V compact impact driver</b><span>Product announcement</span></div><em class="o">Launch</em></div>
            <div class="r"><div><b>Nina Patel</b><span>Packaging Buyer</span></div><em class="b">Contact</em></div>
            <div class="r"><div><b>Outlook draft</b><span>Hi Nina, are you still sourcing corrugated inserts for the new 18V driver? I can send two die-cut options.</span></div><em class="g">Review</em></div>
          </div>
        </div>`,
    },
    {
      title: 'Follow up after trade shows',
      description: 'Turn the rep’s notes into a draft that picks up where the conversation left off. The rep can edit it and decide when to send.',
      icon: '<path d="M4 5h16v11H9l-5 4V5zM8 9h8m-8 3h5"/>',
      visual: `
        <div class="v v-wa">
          <div class="hd"><span class="av">${CL('#075E54', 18)}</span>Morgan Lee · PACK EXPO</div>
          <div class="msg me">Harborline Equipment: regulator moves in the carton. Promised two insert options by Friday.</div>
          <div class="msg so"><b>Email draft</b>Hi Morgan, good meeting you at PACK EXPO. Can you send the carton dimensions? I’ll get two insert options over by Friday.</div>
          <div class="acts"><span class="go">Review draft</span><span>Edit</span></div>
        </div>`,
    },
    {
      title: 'Compare supplier quotes',
      description: 'A customer requests pricing. Your rep asks suppliers for quotes, compares their replies, then chooses the supplier and sets the customer price.',
      icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
      visual: `
        <div class="v v-sheet">
          <div class="req"><span class="who">Harborline Equipment</span> 5,000 die-cut inserts</div>
          <div class="sheet">
            <div class="hd"><span>Supplier bids</span><span>Business days</span></div>
            <div class="rw"><span>Redwood Carton · 10 days</span><span>$0.38/unit</span></div>
            <div class="rw hit"><span>Ridgeway Packaging · 5 days</span><span>$0.43/unit</span></div>
            <div class="rw"><span>Pioneer Corrugated · 7 days</span><span>$0.41/unit</span></div>
          </div>
        </div>`,
    },
    {
      title: 'Make the next account call count',
      description: 'Bring account notes and open requests together so reps know what to bring up on their next call.',
      icon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
      visual: `
        <div class="v v-call">
          <div class="who"><div class="av">DB</div><b>Dana Brooks · Crestview Motion</b><small>Purchasing · Call prep</small></div>
          <div class="wave" aria-hidden="true">${'<i></i>'.repeat(13)}</div>
          <div class="lines">
            <div class="ln b">Line two starts Monday. Dana needs 200 double-wall cartons before then.</div>
            <div class="ln s">Last order: 18 × 14 × 12 in. cartons.</div>
            <div class="ln b">Confirm size and check Thursday delivery.</div>
          </div>
        </div>`,
    },
  ];

  const section = el(`
    <div id="sb-feat" class="sb-feat">
      <div class="head"><h2>Put AI to work on the everyday.</h2><p>See how your reps could act on buyer news, follow up after a show, and compare supplier quotes.</p></div>
      <div class="grid">
        <div class="stage">
          ${workflows.map(({visual}, i) => `<div id="sb-feature-${i}" class="mock">${visual}</div>`).join('')}
        </div>
        <div class="list">
          ${workflows.map(({title, description, icon}, i) => `
            <div class="it">
              <h4><button type="button" aria-controls="sb-feature-${i} sb-feature-detail-${i}">
                <i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6">${icon}</svg></i>${title}
              </button></h4>
              <div class="d" id="sb-feature-detail-${i}"><p>${description}</p></div>
            </div>`).join('')}
        </div>
      </div>
    </div>`);
  container.appendChild(section);

  const panels = [...section.querySelectorAll('.mock')];
  const items = [...section.querySelectorAll('.it')];
  const controls = [...section.querySelectorAll('.it button')];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let visible = false;
  let selectedByReader = false;
  let timer;

  function show(index) {
    current = index;
    panels.forEach((panel, i) => {
      panel.classList.toggle('on', i === index);
      panel.setAttribute('aria-hidden', String(i !== index));
    });
    items.forEach((item, i) => {
      item.classList.toggle('on', i === index);
      item.querySelector('.d').setAttribute('aria-hidden', String(i !== index));
      controls[i].setAttribute('aria-expanded', String(i === index));
    });
  }

  function scheduleRotation() {
    clearTimeout(timer);
    if (!visible || selectedByReader || motion.matches || section.matches(':focus-within')) return;
    timer = setTimeout(() => {
      show((current + 1) % workflows.length);
      scheduleRotation();
    }, 6600);
  }

  controls.forEach((control, index) => {
    control.addEventListener('click', () => {
      selectedByReader = true;
      show(index);
      scheduleRotation();
    });
  });

  section.addEventListener('focusin', scheduleRotation);
  section.addEventListener('focusout', () => requestAnimationFrame(scheduleRotation));
  motion.addEventListener('change', scheduleRotation);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    scheduleRotation();
  });
  observer.observe(section);

  show(0);
}
