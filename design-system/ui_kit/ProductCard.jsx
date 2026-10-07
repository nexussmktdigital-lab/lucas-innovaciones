/* global React, Badge, Price, StockDot, IconHeart */

const ProductCard = ({ p, onOpen }) => {
  const [hover, setHover] = React.useState(false);
  const [fav, setFav] = React.useState(false);
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen && onOpen(p)}
      style={{
        background: "#fff", border: "1px solid var(--li-border)", borderRadius: 16, padding: 14,
        display: "flex", flexDirection: "column", gap: 10, cursor: "pointer",
        transition: "all 200ms var(--li-ease)",
        boxShadow: hover ? "var(--li-shadow-md)" : "none",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        position: "relative",
      }}>
      {p.badge && <span style={{ position: "absolute", top: 16, left: 16, zIndex: 2 }}>
        <Badge pixel tone={p.badgeTone || "green"}>{p.badge}</Badge>
      </span>}
      <button onClick={(e) => { e.stopPropagation(); setFav(!fav); }}
        style={{ position: "absolute", top: 12, right: 12, width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.95)", border: "1px solid var(--li-border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2, color: fav ? "#D63131" : "#6B6B6B" }}>
        <IconHeart size={16} fill={fav ? "currentColor" : "none"}/>
      </button>
      <div style={{ background: p.imgBg || "#F8F8F8", borderRadius: 10, aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, color: "var(--li-fg-4)", position: "relative", overflow: "hidden" }}>
        {p.emoji ? <span style={{ fontSize: 72, filter: "grayscale(1)", opacity: 0.5 }}>{p.emoji}</span> : <span style={{ fontFamily: "var(--li-font-mono)", fontSize: 11 }}>{p.slug}.jpg</span>}
      </div>
      <div style={{ fontSize: 11, color: "var(--li-fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{p.brand}</div>
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, color: "var(--li-fg-1)", minHeight: 38 }}>{p.name}</div>
      <Price contado={p.price} cuotas={p.cuotas || 12} tachado={p.tachado} size="md"/>
      <StockDot>{p.stockLabel || "Stock · Retiralo hoy"}</StockDot>
    </article>
  );
};

window.ProductCard = ProductCard;

// Mock product catalog
window.CATALOG = [
  { id: "a55", brand: "Samsung",  name: "Galaxy A55 5G 256GB Awesome Navy",      price: 1299000, tachado: 1499000, slug: "samsung-a55",  badge: "−13%",     emoji: "📱" },
  { id: "r14", brand: "Xiaomi",   name: "Redmi Note 14 Pro 5G 256GB",             price:  949000, slug: "xiaomi-r14",    emoji: "📱" },
  { id: "iph", brand: "Apple",    name: "iPhone 15 128GB Negro",                  price: 2390000, slug: "iphone-15",     badge: "NUEVO", badgeTone: "greenDk", emoji: "📱" },
  { id: "moto",brand: "Motorola", name: "Moto G84 5G 256GB Space Black",          price:  649000, slug: "moto-g84",      emoji: "📱" },
  { id: "tv",  brand: "Samsung",  name: 'Smart TV 50" Crystal UHD 4K CU7000',    price:  889000, slug: "samsung-tv50",  emoji: "📺" },
  { id: "jbl", brand: "JBL",      name: "Parlante Bluetooth Go 4 Portátil",       price:   69900, cuotas: 6, slug: "jbl-go4", badge: "TOP", badgeTone: "greenDk", emoji: "🔊" },
  { id: "note",brand: "Lenovo",   name: 'Notebook IdeaPad 3 15" i5 16GB 512GB',   price: 1499000, slug: "lenovo-ip3",    emoji: "💻" },
  { id: "wat", brand: "Xiaomi",   name: "Redmi Watch 5 Active",                    price:   89900, cuotas: 6, slug: "redmi-watch", emoji: "⌚" },
];
