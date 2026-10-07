/* global React */


// ============ ICONS (Lucide-style, 1.75 stroke) ============
const I = ({ d, size = 20, fill = "none", sw = 1.75, children, ...rest }) => (
  <svg {...rest} width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {children || <path d={d}/>}
  </svg>
);
const IconSearch = (p) => <I {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></I>;
const IconCart = (p) => <I {...p}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></I>;
const IconUser = (p) => <I {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></I>;
const IconMenu = (p) => <I {...p}><path d="M3 12h18M3 6h18M3 18h18"/></I>;
const IconX = (p) => <I {...p}><path d="M18 6 6 18M6 6l12 12"/></I>;
const IconChevronR = (p) => <I {...p}><path d="M9 18l6-6-6-6"/></I>;
const IconChevronD = (p) => <I {...p}><path d="m6 9 6 6 6-6"/></I>;
const IconTruck = (p) => <I {...p}><rect x="1" y="7" width="15" height="10" rx="1"/><path d="M16 10h3l3 3v4h-6"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></I>;
const IconShield = (p) => <I {...p}><path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"/><path d="m9 12 2 2 4-4"/></I>;
const IconCard = (p) => <I {...p}><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 10h20"/></I>;
const IconWhats = (p) => <I {...p} sw={0}><path fill="currentColor" d="M20 3.5A10 10 0 0 0 4 16l-1 5 5-1A10 10 0 1 0 20 3.5zM12 21a8.6 8.6 0 0 1-4.4-1.2l-.3-.2-3 .6.6-3-.2-.3A8.8 8.8 0 1 1 12 21zm4.6-6.4c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.7.9c-.1.2-.2.2-.5.1-1-.5-2-1.2-2.9-2.5-.2-.3 0-.3.1-.5l.3-.5c.1-.1.1-.2.2-.4 0-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4c-.2 0-.4 0-.6.3-.2.2-.8.8-.8 2s.9 2.3 1 2.5c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.1z"/></I>;
const IconHeart = (p) => <I {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1 7.8 7.8 7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.9z"/></I>;
const IconMapPin = (p) => <I {...p}><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></I>;
const IconStar = (p) => <I {...p} fill="currentColor" sw={0}><path d="m12 2 3 7 7.5.6-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5L9 9z"/></I>;
const IconZap = (p) => <I {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></I>;
const IconCheck = (p) => <I {...p}><path d="M20 6 9 17l-5-5"/></I>;
const IconPlus = (p) => <I {...p}><path d="M12 5v14M5 12h14"/></I>;
const IconMinus = (p) => <I {...p}><path d="M5 12h14"/></I>;

// ============ PRIMITIVES ============
const Button = ({ variant = "primary", size = "md", icon, iconRight, children, ...rest }) => {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--li-font-sans)", fontWeight: 600, borderRadius: 10, cursor: "pointer", border: "1px solid transparent", transition: "all 200ms var(--li-ease)", whiteSpace: "nowrap" };
  const sizes = { sm: { padding: "8px 14px", fontSize: 13, borderRadius: 8 }, md: { padding: "12px 20px", fontSize: 15 }, lg: { padding: "16px 28px", fontSize: 17 } };
  const variants = {
    primary: { background: "var(--li-green)", color: "var(--li-black)", boxShadow: "var(--li-shadow-green)" },
    dark:    { background: "var(--li-black)", color: "#fff" },
    outline: { background: "transparent", color: "var(--li-black)", borderColor: "var(--li-black)" },
    ghost:   { background: "transparent", color: "var(--li-fg-1)" },
    whatsapp:{ background: "var(--li-whatsapp)", color: "#fff" },
  };
  return (
    <button {...rest} style={{ ...base, ...sizes[size], ...variants[variant], ...(rest.style || {}) }}>
      {icon}{children}{iconRight}
    </button>
  );
};

const Badge = ({ tone = "neutral", children, pixel, style }) => {
  const tones = {
    neutral: { bg: "#EDEDED", fg: "#3A3A3A" },
    success: { bg: "#E6F9EC", fg: "#00A63A" },
    warn:    { bg: "#FFF4D6", fg: "#8A5F00" },
    danger:  { bg: "#FCE8E8", fg: "#D63131" },
    green:   { bg: "var(--li-green)", fg: "var(--li-black)" },
    black:   { bg: "var(--li-black)", fg: "#fff" },
    greenDk: { bg: "var(--li-black)", fg: "var(--li-green)" },
  };
  const t = tones[tone] || tones.neutral;
  if (pixel) return <span style={{ fontFamily: "var(--li-font-pixel)", fontSize: 14, background: t.bg, color: t.fg, padding: "2px 10px", borderRadius: 4, ...style }}>{children}</span>;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: t.bg, color: t.fg, ...style }}>{children}</span>;
};

const StockDot = ({ children = "Stock · Retiralo hoy", color = "#00A63A" }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color, fontWeight: 600 }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }}/>{children}
  </span>
);

const Price = ({ contado, cuotas = 12, tachado, size = "md" }) => {
  const perCuota = Math.round(contado / cuotas).toLocaleString("es-AR");
  const sizeMap = { sm: 18, md: 22, lg: 30, xl: 44 };
  return (
    <div>
      {tachado && <div style={{ color: "var(--li-fg-4)", textDecoration: "line-through", fontSize: 14 }}>$ {tachado.toLocaleString("es-AR")}</div>}
      <div style={{ fontFamily: "var(--li-font-display)", fontSize: sizeMap[size], fontWeight: 700, color: "var(--li-price)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>$ {contado.toLocaleString("es-AR")}</div>
      <div style={{ fontSize: size === "xl" ? 16 : 13, color: "#00A63A", fontWeight: 600, marginTop: 4 }}>
        o <b>{cuotas} cuotas sin interés</b> de $ {perCuota}
      </div>
    </div>
  );
};

const Logo = ({ dark, size = 32 }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
    <div style={{ width: size, height: size, borderRadius: "50%", background: dark ? "#fff" : "var(--li-black)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 }}>
      <span style={{ fontFamily: "var(--li-font-display)", fontWeight: 800, fontSize: size * 0.55, color: dark ? "var(--li-black)" : "#fff", lineHeight: 1 }}>L.</span>
      <span style={{ position: "absolute", right: -size * 0.18, bottom: -size * 0.06, width: size * 0.42, height: size * 0.42, borderRadius: "50%", background: "var(--li-green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size * 0.24} height={size * 0.24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M12 2v10M18.36 6.64a9 9 0 1 1-12.72 0"/></svg>
      </span>
    </div>
    <span style={{ fontFamily: "var(--li-font-display)", fontWeight: 700, fontSize: size * 0.48, letterSpacing: "-0.02em", color: dark ? "#fff" : "var(--li-black)" }}>Lucas Innovaciones</span>
  </div>
);

const WhatsappFab = () => (
  <a href="#" style={{ position: "fixed", bottom: 24, right: 24, width: 60, height: 60, borderRadius: "50%", background: "var(--li-whatsapp)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 28px rgba(37,211,102,0.45)", zIndex: 50 }} aria-label="WhatsApp">
    <IconWhats size={30}/>
  </a>
);

// Expose
Object.assign(window, { Button, Badge, Price, StockDot, Logo, WhatsappFab,
  IconSearch, IconCart, IconUser, IconMenu, IconX, IconChevronR, IconChevronD,
  IconTruck, IconShield, IconCard, IconWhats, IconHeart, IconMapPin, IconStar,
  IconZap, IconCheck, IconPlus, IconMinus });
