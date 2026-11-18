function rows() {
  const container = $('[data-framer-name="Solutions Section"] .framer-1amiabt');
  if (!container || $('#sb-rows', container)) return;

  const followUps = [
    ['Morgan Lee', 'Harborline Equipment · PACK EXPO · insert samples Friday', 'Draft'],
    ['Nina Patel', 'Alder Ridge Tools · confirm insert dimensions for the 18V driver', 'Review'],
    ['Dana Brooks', 'Crestview Motion · confirm stock for 200 shipping cartons', 'Reminder'],
  ];
  const desk = `
    <div class="g-desk">
      <div class="map" aria-hidden="true">
        <svg class="mapsvg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet">
          <path d="M-10 60 C40 20 90 70 140 40 S200 50 210 30 L210 -10 L-10 -10Z M-10 230 C40 200 70 260 120 230 S180 250 210 220 L210 310 L-10 310Z" fill="#DFF0E3"/>
          <path d="M44 232 Q70 190 100 150 M156 92 Q130 120 100 150 M46 70 Q75 110 100 150" stroke="#9CC9A6" stroke-width="1.6" stroke-dasharray="3 6" fill="none"/>
          <g font-family="Inter,sans-serif" font-size="11" font-weight="600" fill="#1b2b1f">
            <circle cx="44" cy="232" r="7" fill="#0099FF"/>
            <circle cx="44" cy="232" r="3" fill="#fff"/>
            <circle class="ring" cx="44" cy="232" r="7" fill="none" stroke="#0099FF" stroke-width="2"/>
            <text x="57" y="236">Trade show</text>
            <circle cx="156" cy="92" r="7" fill="#1DA462"/>
            <circle cx="156" cy="92" r="3" fill="#fff"/>
            <circle class="ring" cx="156" cy="92" r="7" fill="none" stroke="#1DA462" stroke-width="2" style="animation-delay:2s"/>
            <text x="143" y="96" text-anchor="end">Accounts</text>
            <circle cx="46" cy="70" r="7" fill="#F59E0B"/>
            <circle cx="46" cy="70" r="3" fill="#fff"/>
            <circle class="ring" cx="46" cy="70" r="7" fill="none" stroke="#F59E0B" stroke-width="2" style="animation-delay:4s"/>
            <text x="59" y="74">Open quotes</text>
            <circle cx="100" cy="150" r="17" fill="#0B1A2B"/>
            <g transform="translate(90 140) scale(0.83)">${CL('#fff', 24)}</g>
            <text x="100" y="184" text-anchor="middle">Your desk</text>
          </g>
        </svg>
      </div>
      <div class="list">
        <h5>Follow-up queue <small>3 open drafts and reminders</small></h5>
        ${followUps.map(([title, detail, status], index) => `
          <div class="${['b', 'g', 'o'][index]}" style="animation-delay:${index * 2}s">
            <i aria-hidden="true"></i><div><b>${title}</b><span>${detail}</span></div><em>${status}</em>
          </div>
        `).join('')}
      </div>
    </div>`;
  const quotes = `
    <div class="g-pricewrap">
      <div class="g-price">
        <div class="sb-quote-title">Supplier bids · 5,000 die-cut corrugated inserts</div>
        <div class="row">
          <div class="lab">Redwood Carton<b>10 business days</b></div>
          <div class="num cut">$0.38<small>/unit</small></div>
        </div>
        <div class="row">
          <div class="lab">Ridgeway Packaging<b>5 business days</b></div>
          <div class="num win">$0.43<small>/unit</small>
            <svg viewBox="0 0 140 60" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="70" cy="30" rx="66" ry="26"/></svg>
          </div>
        </div>
      </div>
      <div class="g-profit sb-quote-selection">Rep chose the 5-day lead time</div>
    </div>`;
  const outcomes = [
    {
      id: 'outbound',
      label: 'Sales opportunities',
      title: 'Know who to call and why now.',
      description: 'Give reps a point of entry when a manufacturer launches a product, opens a facility, or changes what it buys.',
      graphic: '<div class="g-stack" data-stack role="group" aria-label="Sales opportunity queue"></div>',
    },
    {
      id: 'supplier-quotes',
      label: 'Supplier quotes',
      title: 'See the trade-offs before you quote.',
      description: 'Compare supplier prices and lead times side by side. Your rep chooses the supplier and sets the customer price.',
      graphic: quotes,
    },
    {
      id: 'follow-up',
      label: 'Customer follow-ups',
      title: 'Pick up the conversation.',
      description: 'Use trade-show notes, account context, and open quotes to prepare follow-ups your reps can review and send.',
      graphic: desk,
    },
  ];
  const section = el(`
    <div id="sb-rows" class="sb-rows">
      <nav class="labels" aria-label="Sales workflows">
        ${outcomes.map(({ id, label }) => `<a href="#${id}">${label}</a>`).join('')}
      </nav>
      <div class="right">
        ${outcomes.map(({ id, title, description, graphic }) => `
          <article class="sb-row" id="${id}">
            <div><h3>${title}</h3><p>${description}</p></div>
            <div class="gfx">${graphic}</div>
          </article>
        `).join('')}
      </div>
    </div>`);
  container.appendChild(section);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const stack = $('[data-stack]', section);
  const signals = [
    ['Alder Ridge Tools', '18V compact impact driver launch · Nina Patel, Packaging Buyer · corrugated inserts', 'Outlook draft'],
    ['Harborline Equipment', 'Morgan Lee · offer insert samples after PACK EXPO', 'Draft'],
    ['Crestview Motion', 'Second assembly shift · check demand for shipping cartons', 'Research'],
    ['Fairhaven Controls', 'New sensor kit · offer a protective insert sample', 'Review'],
    ['Stonebridge Pumps', 'New service center · ask about stocking kits', 'Research'],
  ];
  let nextSignal = 1;
  const cards = [];
  function addCard([title, detail, status], className) {
    const card = el(`<div class="${className}"><b>${title}<small>${status}</small></b><span>${detail}</span></div>`);
    stack.appendChild(card);
    cards.unshift(card);
  }
  function positionCards() {
    cards.forEach((card, index) => {
      card.className = index === 0 ? 'c top' : `c l${index}`;
      // The cards behind the front card are decorative.
      card.setAttribute('aria-hidden', String(index !== 0));
    });
  }
  function pushCard() {
    addCard(signals[nextSignal], 'c new');
    nextSignal = (nextSignal + 1) % signals.length;
    if (cards.length > signals.length) cards.pop().remove();
    requestAnimationFrame(() => requestAnimationFrame(positionCards));
  }
  // Populate the original stack immediately, with the product announcement on top.
  signals.slice().reverse().forEach(signal => addCard(signal, 'c'));
  positionCards();
  let rotation;
  function syncMotion() {
    clearInterval(rotation);
    if (!motion.matches) rotation = setInterval(pushCard, 2600);
  }
  motion.addEventListener('change', syncMotion);
  syncMotion();

  const panels = [...section.querySelectorAll('.sb-row')];
  const links = [...section.querySelectorAll('.labels a')];
  function markActive() {
    const viewportCenter = innerHeight / 2;
    let active = 0;
    let distance = Infinity;
    panels.forEach((panel, index) => {
      const bounds = panel.getBoundingClientRect();
      const panelDistance = Math.abs(bounds.top + bounds.height / 2 - viewportCenter);
      if (panelDistance < distance) {
        active = index;
        distance = panelDistance;
      }
    });
    links.forEach((link, index) => {
      link.classList.toggle('on', index === active);
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('scroll', markActive, { passive: true });
  addEventListener('resize', markActive);
  markActive();
}
