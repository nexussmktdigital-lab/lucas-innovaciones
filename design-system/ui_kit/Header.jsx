/* global React, Button, Badge, IconSearch, IconCart, IconUser, IconMenu, IconMapPin, IconWhats, Logo */


const Header = ({ cartCount = 2, onNav, current = "home" }) => {
  const [q, setQ] = React.useState("");
  return (
    <header style={{ background: "#fff", borderBottom: "1px solid var(--li-border)", position: "sticky", top: 0, zIndex: 40 }}>
      {/* Top micro-bar */}
      <div style={{ background: "var(--li-black)", color: "#fff", fontSize: 12 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#B8B8B8" }}>
            <IconMapPin size={14}/> Villa Santa Rosa, Córdoba · Retiro en local y envíos a zona
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 16, color: "#B8B8B8" }}>
            <a href="#" style={{ color: "var(--li-green)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconWhats size={14}/> +54 3574 443092
            </a>
            <span>Seguinos: @lucas_innovaciones</span>
          </span>
        </div>
      </div>
      {/* Main bar */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center" }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onNav("home"); }} style={{ textDecoration: "none" }}>
          <Logo size={34}/>
        </a>
        <div style={{ position: "relative", maxWidth: 540, width: "100%", justifySelf: "center" }}>
          <IconSearch size={18} style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: 14, color: "var(--li-fg-3)" }}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué necesitás hoy? ej. iPhone 15, Smart TV 50..."
            style={{ width: "100%", padding: "12px 14px 12px 42px", border: "1px solid var(--li-border-strong)", borderRadius: 10, fontSize: 14, fontFamily: "var(--li-font-sans)", boxSizing: "border-box", outline: "none" }}/>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={iconBtn} title="Mi cuenta"><IconUser/></button>
          <button style={{ ...iconBtn, position: "relative" }} title="Carrito" onClick={() => onNav("checkout")}>
            <IconCart/>
            {cartCount > 0 && <span style={cartBadge}>{cartCount}</span>}
          </button>
        </div>
      </div>
      {/* Category nav */}
      <nav style={{ borderTop: "1px solid var(--li-border)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "10px 24px", display: "flex", gap: 22, alignItems: "center", overflowX: "auto" }}>
          <button style={{ ...navItem, background: "var(--li-black)", color: "#fff", padding: "6px 14px", borderRadius: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <IconMenu size={16}/> Todas las categorías
          </button>
          {["Celulares", "Notebooks", "Smart TV", "Smartwatch", "Audio", "Accesorios", "Tablets", "Gaming"].map((c) => (
            <a key={c} href="#" style={navItem}>{c}</a>
          ))}
          <span style={{ marginLeft: "auto", ...navItem, color: "#00A63A", fontWeight: 600 }}>Ofertas</span>
        </div>
      </nav>
    </header>
  );
};

const iconBtn = { width: 40, height: 40, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--li-fg-1)", position: "relative" };
const cartBadge = { position: "absolute", top: 2, right: 2, background: "var(--li-green)", color: "var(--li-black)", fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" };
const navItem = { fontSize: 14, color: "var(--li-fg-2)", textDecoration: "none", whiteSpace: "nowrap", fontWeight: 500, cursor: "pointer", border: "none", background: "transparent", fontFamily: "inherit" };

window.Header = Header;
