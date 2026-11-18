function feature() {
  const container = $('[data-framer-name="Feature Section"] [data-framer-name="Container"]');
  if (!container || $('#sb-feat', container)) return;

  const workflows = [
    {
      title: 'Find sales opportunities',
      description: 'Turn a manufacturer’s product announcement into a reason to reach out. Find the right purchasing or packaging contact and prepare an Outlook draft for your rep to review.',
      icon: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
      visual: `
        <div class="v v-bd">
          <div class="top"><div class="from">Example workflow</div><div class="subj">From product launch to Outlook draft</div></div>
          <div class="rows">
            <div class="r"><div><b>Manufacturer launches a new line</b><span>New products may need new packaging</span></div><em class="o">Signal</em></div>
            <div class="r"><div><b>Packaging buyer</b><span>Purchasing contact for the new line</span></div><em class="b">Contact</em></div>
            <div class="r"><div><b>Outlook draft</b><span>“Are you reviewing packaging options for the launch?”</span></div><em class="g">Review</em></div>
          </div>
        </div>`,
    },
    {
      title: 'Follow up after trade shows',
      description: 'Turn the rep’s notes into a draft that picks up where the conversation left off. The rep can edit it and decide when to send.',
      icon: '<path d="M4 5h16v11H9l-5 4V5zM8 9h8m-8 3h5"/>',
      visual: `
        <div class="v v-wa">
          <div class="hd"><span class="av">${CL('#075E54', 18)}</span>Example · Trade-show follow-up</div>
          <div class="msg me">Booth notes: needs a protective insert. Promised sample options Friday.</div>
          <div class="msg so"><b>Email draft</b>Good meeting you at the show. Is Friday still a good time to look at insert samples?</div>
          <div class="acts"><span class="go">Review draft</span><span>Edit</span></div>
        </div>`,
    },
    {
      title: 'Compare supplier quotes',
      description: 'A customer requests pricing. Your rep asks suppliers for quotes, compares their replies, then chooses the supplier and sets the customer price.',
      icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
      visual: `
        <div class="v v-sheet">
          <div class="req"><span class="who">Customer request</span> 5,000 cartons</div>
          <div class="sheet">
            <div class="hd"><span>Supplier replies</span><span>Example quotes</span></div>
            <div class="rw"><span>Supplier A · 10 days</span><span>$0.38/unit</span></div>
            <div class="rw hit"><span>Supplier B · 5 days</span><span>$0.43/unit</span></div>
            <div class="rw"><span>Supplier C · 7 days</span><span>$0.41/unit</span></div>
          </div>
        </div>`,
    },
    {
      title: 'Make the next account call count',
      description: 'Bring account notes and open requests together so reps know what to bring up on their next call.',
      icon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
      visual: `
        <div class="v v-call">
          <div class="who"><div class="av">CR</div><b>Existing customer</b><small>Example · Call prep</small></div>
          <div class="wave" aria-hidden="true">${'<i></i>'.repeat(13)}</div>
          <div class="lines">
            <div class="ln b">Last conversation: customer asked about shorter lead times.</div>
            <div class="ln s">Open item: cartons for the next run.</div>
            <div class="ln b">Ask when the next shipment needs to arrive.</div>
          </div>
        </div>`,
    },
  ];

  const section = el(`
    <div id="sb-feat" class="sb-feat">
      <div class="head"><h2>Put AI to work on the everyday.</h2><p>Examples of workflows we can build for your sales team.</p></div>
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
