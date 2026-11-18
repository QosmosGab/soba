/* The original five-spoke Soba canvas, with tools distributor sales teams use. */
function hub() {
  const canvas = $('[data-framer-name="Integration Section"] [data-framer-name="Canvas"]');
  if (!canvas || $('#sb-hub', canvas)) return;

  const tools = [
    {
      name: 'Email',
      angle: 90,
      color: '#E44B39',
      glyph: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    },
    {
      name: 'Salesforce',
      angle: 162,
      color: '#009EDB',
      glyph: '<path d="M6 18a4 4 0 0 1-.5-8A5 5 0 0 1 15 8a4 4 0 0 1 5 3 3.5 3.5 0 0 1-.5 7H6Z" fill="white" stroke="none"/>',
    },
    {
      name: 'Google Sheets',
      angle: 234,
      color: '#169B5F',
      glyph: '<path d="M6 3h8l4 4v14H6zM14 3v5h4"/><path d="M8.5 11h7v6h-7zM8.5 14h7M12 11v6"/>',
    },
    {
      name: 'Google Docs',
      angle: 306,
      color: '#4285F4',
      glyph: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 11h6m-6 3h6m-6 3h4"/>',
    },
    {
      name: 'Outlook',
      angle: 18,
      color: '#0078D4',
      glyph: '<path d="M12 6h9v13H12m0-10 9 5"/><rect x="2.5" y="5" width="10" height="13" rx="1.5"/><ellipse cx="7.5" cy="11.5" rx="2.25" ry="3"/>',
    },
  ];
  const center = 275;
  const radius = 216;
  const spokes = tools.map(({ name, angle, color, glyph }, index) => {
    const radians = angle * Math.PI / 180;
    const x = center + radius * Math.cos(radians);
    const y = center + radius * Math.sin(radians);
    const path = `M${x} ${y} L${center} ${center}`;
    return `
      <path d="${path}" stroke="#dcdcdc" stroke-width="2" fill="none"/>
      <circle class="sb-stack-pulse" r="5" fill="#1DA462">
        <animateMotion path="${path}" dur="${2.6 + index * .35}s" begin="${index * .5 - 2}s" repeatCount="indefinite"/>
      </circle>
      <g class="tile" transform="translate(${x - 36} ${y - 36})">
        <rect width="72" height="72" rx="20" fill="${color}"/>
        <g transform="translate(18 18) scale(1.5)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          ${glyph}
        </g>
      </g>
      <text class="node" x="${x}" y="${y + 52}" text-anchor="middle">${name}</text>`;
  }).join('');

  canvas.appendChild(el(`
    <div id="sb-hub" class="sb-hub">
      <svg viewBox="0 0 550 550" role="img" aria-labelledby="sb-stack-title">
        <title id="sb-stack-title">Examples of tools used by distributor sales teams: Salesforce, Google Sheets, Google Docs, email and Outlook.</title>
        <style>@media (prefers-reduced-motion: reduce) { .sb-stack-pulse { display: none } }</style>
        <defs>
          <pattern id="sb-stack-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#e6e6e6"/>
          </pattern>
        </defs>
        <rect width="550" height="550" fill="url(#sb-stack-dots)"/>
        ${spokes}
        <circle cx="${center}" cy="${center}" r="64" fill="#fff" stroke="#e6e6e6" stroke-width="2"/>
        <g transform="translate(${center - 40} ${center - 40})">${CL('#0B1A2B', 80)}</g>
      </svg>
    </div>`));
}
