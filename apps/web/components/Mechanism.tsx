/** Authored schematic of the settlement path: mandates in, one escrow, three ways out. */
export function Mechanism() {
  const step = (x: number, title: string, sub: string, k: string) => (
    <g transform={`translate(${x},120)`} key={k}>
      <rect width="150" height="64" rx="2" fill="#16161a" stroke="rgba(237,235,230,.14)" />
      <text x="14" y="27" fill="#edebe6" fontSize="15" fontFamily="var(--display)" letterSpacing="-.02em">{title}</text>
      <text x="14" y="47" fill="#8c8a85" fontSize="11" fontFamily="var(--sans)">{sub}</text>
    </g>
  );
  const exit = (y: number, title: string, sub: string, color: string, k: string) => (
    <g key={k}>
      <path d={`M 870 152 C 920 152, 920 ${y + 22}, 970 ${y + 22}`} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 4" className="flow" />
      <g transform={`translate(970,${y})`}>
        <rect width="200" height="44" rx="2" fill="#101012" stroke={color} strokeOpacity=".55" />
        <circle cx="16" cy="22" r="4" fill={color} />
        <text x="30" y="20" fill="#edebe6" fontSize="14" fontFamily="var(--display)">{title}</text>
        <text x="30" y="35" fill="#8c8a85" fontSize="10.5" fontFamily="var(--sans)">{sub}</text>
      </g>
    </g>
  );
  return (
    <div className="schematic">
      <svg viewBox="0 0 1200 300" role="img" aria-label="Intent mandate, cart mandate and payment mandate lead into one escrow vault, which releases, refunds or splits">
        <defs>
          <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".8" fill="rgba(237,235,230,.08)" />
          </pattern>
        </defs>
        <rect width="1200" height="300" fill="url(#dots)" />
        {step(10, "Intent", "user signs once · refundable", "i")}
        {step(190, "Cart", "merchant · pay_to = vault", "c")}
        {step(370, "Payment", "EIP-3009 to the vault", "p")}
        {[160, 340, 520].map((x) => (
          <path key={x} d={`M ${x} 152 H ${x + 30}`} stroke="rgba(237,235,230,.35)" strokeWidth="1.5" />
        ))}
        <text x="560" y="84" fill="#6b6a66" fontSize="11" fontFamily="var(--sans)">HSP gateway relays the transfer here</text>
        <g transform="translate(560,96)">
          <rect width="310" height="112" rx="2" fill="#16161a" stroke="#ffb547" strokeOpacity=".7" />
          <text x="18" y="34" fill="#edebe6" fontSize="20" fontFamily="var(--display)" letterSpacing="-.03em">Vault</text>
          <text x="18" y="56" fill="#a3a19c" fontSize="12" fontFamily="var(--sans)">address = CREATE2(keccak(terms))</text>
          <text x="18" y="86" fill="#ffb547" fontSize="15" fontFamily="var(--dots)" letterSpacing=".04em">0x7f3a…c41e  holding</text>
        </g>
        {exit(40, "Released", "delivered and accepted, or no objection", "#7fd1a6", "r")}
        {exit(130, "Refunded", "nothing delivered by the deadline", "#ffb547", "f")}
        {exit(220, "Split by ruling", "any 2 of 3 validators agree", "#a3a19c", "s")}
      </svg>
    </div>
  );
}
