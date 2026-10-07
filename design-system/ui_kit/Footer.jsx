/* global React, Logo, IconWhats, IconMapPin */

const Footer = () => (
  <footer style={{ background: "var(--li-black)", color: "#B8B8B8", marginTop: 80 }}>
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "56px 24px 24px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 40 }}>
      <div>
        <Logo dark size={34}/>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 20, color: "#B8B8B8", maxWidth: 320 }}>
          Tu local de tecnología en Villa Santa Rosa desde 2017. Garantía real, atención humana y envíos a toda la zona.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {["IG", "FB", "WA"].map(s => (
            <span key={s} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>{s}</span>
          ))}
        </div>
      </div>
      <FooterCol title="Catálogo" items={["Celulares", "Notebooks", "Smart TV", "Smartwatch", "Audio", "Gaming"]}/>
      <FooterCol title="Ayuda" items={["Seguir mi pedido", "Garantía", "Política de cambio", "Formas de pago", "Formas de entrega"]}/>
      <div>
        <h4 style={colTitle}>Contacto</h4>
        <ul style={colList}>
          <li style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}><IconMapPin size={14} style={{ marginTop: 3, color: "var(--li-green)" }}/> Belgrano 847, Villa Santa Rosa, Córdoba</li>
          <li style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}><IconWhats size={14} style={{ color: "var(--li-green)" }}/> +54 3574 443092</li>
          <li style={{ color: "#9A9A9A", fontSize: 12, marginTop: 14 }}>Lun a Vie: 9:00 – 13:00 · 17:00 – 21:00<br/>Sábados: 9:30 – 13:00</li>
        </ul>
      </div>
    </div>
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", borderTop: "1px solid #1F1F1F", display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", flexWrap: "wrap", gap: 14 }}>
      <span>© 2026 Lucas Innovaciones · CUIT 20-XXXXXXXX-X · Todos los derechos reservados</span>
      <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {["Mercado Pago", "Naranja", "Cuota Simple", "Visa", "Mastercard"].map(p => (
          <span key={p} style={{ padding: "4px 10px", border: "1px solid #1F1F1F", borderRadius: 6, fontSize: 11, color: "#B8B8B8", background: "#141414" }}>{p}</span>
        ))}
      </span>
    </div>
  </footer>
);

const FooterCol = ({ title, items }) => (
  <div>
    <h4 style={colTitle}>{title}</h4>
    <ul style={colList}>{items.map(i => <li key={i} style={{ marginBottom: 8 }}><a href="#" style={{ color: "#B8B8B8", textDecoration: "none" }}>{i}</a></li>)}</ul>
  </div>
);

const colTitle = { color: "#fff", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 14px" };
const colList  = { listStyle: "none", padding: 0, margin: 0, fontSize: 14, lineHeight: 1.6 };

window.Footer = Footer;
