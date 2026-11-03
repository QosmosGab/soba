// The Soba clover, the same mark as the site's favicon, inline so it inherits nothing and needs no request.
export function Clover({ size = 26 }: { size?: number }) {
  const leaf = "M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(32 37)" fill="none" stroke="#0099FF" strokeWidth="6.5" strokeLinejoin="round">
        <path d={leaf} /><path d={leaf} transform="rotate(120)" /><path d={leaf} transform="rotate(240)" />
      </g>
    </svg>
  );
}
