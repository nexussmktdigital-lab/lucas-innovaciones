/* global React, Button, Badge, Price, StockDot, ProductCard, CATALOG,
   IconShield, IconTruck, IconWhats, IconChevronR, IconChevronD, IconCheck,
   IconPlus, IconMinus, IconHeart */

const Product = ({ p, onBack, onOpenProduct, onCheckout }) => {
  const [qty, setQty] = React.useState(1);
  const [img, setImg] = React.useState(0);
  const [openSpec, setOpen] = React.useState("specs");

  const specs = {
    specs: [
      ["Pantalla", '6.6" Super AMOLED 120Hz'],
      ["Procesador", "Exynos 1480 octa-core"],
      ["Memoria", "8 GB RAM · 256 GB almacenamiento"],
      ["Cámara", "Triple 50 MP + 12 MP + 5 MP · Frontal 32 MP"],
      ["Batería", "5.000 mAh · Carga 25W"],
      ["Conectividad", "5G · Wi-Fi 6 · Bluetooth 5.3 · NFC"],
    ],
    envio: [["Retiro en local", "Hoy desde las 17:00"], ["Envío VSR y zona", "24 hs · $ 0"], ["Envío Córdoba Capital", "48–72 hs · $ 4.900"], ["Resto del país", "Andreani · 3–5 días"]],
    garantia: [["Garantía oficial Samsung", "12 meses"], ["Garantía Lucas Innovaciones", "6 meses adicionales en local"], ["Cambios por fallas", "Hasta 30 días corridos"]],
  };

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 60px" }}>
      {/* breadcrumb */}
      <nav style={{ fontSize: 13, color: "var(--li-fg-3)", marginBottom: 20, display: "flex", gap: 8, alignItems: "center" }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ color: "var(--li-fg-3)", textDecoration: "none" }}>Inicio</a>
        <IconChevronR size={12}/>
        <a href="#" style={{ color: "var(--li-fg-3)", textDecoration: "none" }}>Celulares</a>
        <IconChevronR size={12}/>
        <a href="#" style={{ color: "var(--li-fg-3)", textDecoration: "none" }}>{p.brand}</a>
        <IconChevronR size={12}/>
        <span style={{ color: "var(--li-fg-1)" }}>{p.name}</span>
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 40 }}>
        {/* Gallery */}
        <div>
          <div style={{ background: "#fff", borderRadius: 20, border: "1px solid var(--li-border)", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
            {p.badge && <span style={{ position: "absolute", top: 20, left: 20 }}><Badge pixel tone={p.badgeTone || "green"}>{p.badge}</Badge></span>}
            <button style={{ position: "absolute", top: 20, right: 20, width: 40, height: 40, borderRadius: "50%", background: "#fff", border: "1px solid var(--li-border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><IconHeart size={18}/></button>
            <div style={{ fontSize: 160, filter: "grayscale(0.3)" }}>{p.emoji || "📱"}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 14 }}>
            {[0,1,2,3,4].map(i => (
              <button key={i} onClick={() => setImg(i)} style={{ background: "#fff", border: `2px solid ${img === i ? "var(--li-black)" : "var(--li-border)"}`, borderRadius: 10, aspectRatio: "1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, filter: "grayscale(0.5)", opacity: img === i ? 1 : 0.6 }}>{p.emoji || "📱"}</button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div>
          <div style={{ fontSize: 12, color: "var(--li-fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>{p.brand}</div>
          <h1 className="li-h1" style={{ margin: "0 0 16px", fontSize: 30 }}>{p.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <StockDot>Stock disponible · Retiralo hoy</StockDot>
            <span style={{ fontSize: 13, color: "var(--li-fg-3)" }}>· SKU {p.id.toUpperCase()}</span>
          </div>

          <div style={{ background: "#fff", border: "1px solid var(--li-border)", borderRadius: 16, padding: 24 }}>
            <Price contado={p.price} cuotas={12} tachado={p.tachado} size="xl"/>
            <div style={{ fontSize: 12, color: "var(--li-fg-3)", marginTop: 8 }}>Precio incluye IVA · Válido para compras online y en local</div>

            <div style={{ height: 1, background: "var(--li-border)", margin: "20px 0" }}/>

            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Color</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {[{ n: "Awesome Navy", c: "#1E3A5F", on: true }, { n: "Iceblue", c: "#B8D4E3" }, { n: "Lilac", c: "#C9B5D9" }].map(c => (
                <button key={c.n} style={{ padding: "8px 14px", borderRadius: 999, border: `1.5px solid ${c.on ? "var(--li-black)" : "var(--li-border-strong)"}`, background: "#fff", fontSize: 13, fontWeight: c.on ? 600 : 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.c, border: "1px solid rgba(0,0,0,0.1)" }}/>{c.n}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--li-border-strong)", borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setQty(Math.max(1, qty-1))} style={qtyBtn}><IconMinus size={14}/></button>
                <span style={{ padding: "0 18px", fontWeight: 600 }}>{qty}</span>
                <button onClick={() => setQty(qty+1)} style={qtyBtn}><IconPlus size={14}/></button>
              </div>
              <Button size="lg" style={{ flex: 1 }} onClick={onCheckout} iconRight={<IconChevronR size={18}/>}>Comprar ahora</Button>
            </div>
            <Button variant="outline" size="lg" style={{ width: "100%" }} icon={<IconWhats size={18}/>}>Consultar por WhatsApp</Button>

            <div style={{ display: "flex", gap: 14, marginTop: 20, padding: "16px 0 0", borderTop: "1px dashed var(--li-border)", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--li-fg-2)" }}><IconTruck size={16} style={{ color: "var(--li-green)" }}/> Envío 24hs a zona</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--li-fg-2)" }}><IconCheck size={16} style={{ color: "var(--li-green)" }}/> Retirá hoy en local</span>
            </div>
          </div>

          {/* Garantía highlight */}
          <div style={{ background: "var(--li-black)", color: "#fff", borderRadius: 16, padding: 18, marginTop: 16, display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--li-green)", color: "var(--li-black)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <IconShield size={22}/>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Garantía Lucas Innovaciones</div>
              <div style={{ fontSize: 12, color: "#B8B8B8", marginTop: 2 }}>12 meses oficial + 6 meses en local. Reclamás en VSR, cara a cara.</div>
            </div>
          </div>

          {/* Accordion specs */}
          <div style={{ marginTop: 20, border: "1px solid var(--li-border)", borderRadius: 16, overflow: "hidden", background: "#fff" }}>
            {Object.entries(specs).map(([k, rows], i, arr) => (
              <div key={k} style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--li-border)" : "none" }}>
                <button onClick={() => setOpen(openSpec === k ? null : k)}
                  style={{ width: "100%", background: "transparent", border: "none", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600 }}>
                  {k === "specs" ? "Especificaciones" : k === "envio" ? "Envío y retiro" : "Garantía y cambios"}
                  <IconChevronD size={18} style={{ transform: openSpec === k ? "rotate(180deg)" : "none", transition: "transform 200ms" }}/>
                </button>
                {openSpec === k && (
                  <div style={{ padding: "0 18px 16px" }}>
                    {rows.map(([k2, v]) => (
                      <div key={k2} style={{ display: "grid", gridTemplateColumns: "200px 1fr", padding: "8px 0", fontSize: 13, borderTop: "1px dashed var(--li-border)" }}>
                        <span style={{ color: "var(--li-fg-3)" }}>{k2}</span><span style={{ color: "var(--li-fg-1)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Related */}
      <section style={{ marginTop: 64 }}>
        <h2 className="li-h2" style={{ margin: "0 0 20px" }}>También podés ver</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {CATALOG.filter(x => x.id !== p.id).slice(0,4).map(x => <ProductCard key={x.id} p={x} onOpen={onOpenProduct}/>)}
        </div>
      </section>
    </main>
  );
};

const qtyBtn = { width: 40, height: 44, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

window.Product = Product;
