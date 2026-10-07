/* global React, Button, Badge, Price, StockDot, ProductCard, CATALOG,
   IconTruck, IconShield, IconCard, IconWhats, IconMapPin, IconStar, IconZap,
   IconChevronR, IconCheck */

const Home = ({ onOpenProduct, onCheckout }) => (
  <main>
    {/* ============ HERO ============ */}
    <section style={{ background: "var(--li-black)", color: "#fff", position: "relative", overflow: "hidden" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 24px 72px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 48, alignItems: "center" }}>
        <div>
          <Badge pixel tone="greenDk" style={{ marginBottom: 20 }}>[ DESTACADO_DEL_MES ]</Badge>
          <h1 style={{ fontFamily: "var(--li-font-display)", fontSize: "clamp(2.5rem, 5vw, 4.25rem)", lineHeight: 1.05, letterSpacing: "-0.03em", margin: 0, fontWeight: 700 }}>
            Tenemos toda la tecnología para brindarte la <span style={{ color: "var(--li-green)" }}>comodidad</span> que te mereces.
          </h1>
          <p style={{ fontSize: 18, color: "#B8B8B8", marginTop: 20, maxWidth: 480, lineHeight: 1.5 }}>
            Celulares, notebooks, smart TVs y más. Atendidos en Villa Santa Rosa, pagás hasta en 12 cuotas sin interés.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            <Button size="lg" iconRight={<IconChevronR size={18}/>}>Ver catálogo</Button>
            <Button size="lg" variant="outline" style={{ borderColor: "#fff", color: "#fff" }} icon={<IconWhats size={18}/>}>Consultar por WhatsApp</Button>
          </div>
          <div style={{ display: "flex", gap: 22, marginTop: 36, color: "#B8B8B8", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconCheck size={14} style={{ color: "var(--li-green)" }}/> 9 años en el pueblo</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconCheck size={14} style={{ color: "var(--li-green)" }}/> Garantía local</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconCheck size={14} style={{ color: "var(--li-green)" }}/> Stock en vivo</span>
          </div>
        </div>
        <div style={{ position: "relative", aspectRatio: "1", maxWidth: 480, justifySelf: "end", width: "100%" }}>
          {/* Product hero visual — a big power button frame holding a phone */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 24, background: "radial-gradient(circle at 50% 50%, rgba(0,230,77,0.22), transparent 60%)" }}/>
          <div style={{ position: "absolute", inset: "10% 10%", borderRadius: "50%", background: "var(--li-green)", boxShadow: "0 30px 80px rgba(0,230,77,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "58%", height: "82%", borderRadius: 32, background: "#0A0A0A", border: "6px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 72, filter: "grayscale(0.2)" }}>📱</div>
          </div>
          <div style={{ position: "absolute", bottom: "6%", right: "0%", background: "#fff", color: "var(--li-black)", padding: "14px 18px", borderRadius: 14, boxShadow: "0 20px 50px rgba(0,0,0,0.4)", width: 240 }}>
            <div style={{ fontSize: 11, color: "var(--li-fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Samsung</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Galaxy A55 5G 256GB</div>
            <Price contado={1299000} cuotas={12} size="sm"/>
          </div>
        </div>
      </div>
    </section>

    {/* ============ BRAND STRIP ============ */}
    <section style={{ background: "#fff", borderBottom: "1px solid var(--li-border)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 24px", display: "flex", gap: 40, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        {["Samsung", "Xiaomi", "Motorola", "Apple", "JBL", "Lenovo", "LG", "Noblex"].map(b => (
          <span key={b} style={{ fontFamily: "var(--li-font-display)", fontWeight: 700, fontSize: 18, color: "var(--li-fg-4)", letterSpacing: "-0.01em" }}>{b}</span>
        ))}
      </div>
    </section>

    {/* ============ CATEGORIES ============ */}
    <section style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 28 }}>
        <h2 className="li-h2" style={{ margin: 0 }}>Elegí tu categoría</h2>
        <a href="#" style={{ fontSize: 14, color: "var(--li-fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>Ver todas →</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14 }}>
        {[
          { n: "Celulares", e: "📱" }, { n: "Accesorios", e: "🎧" }, { n: "Notebooks", e: "💻" },
          { n: "Smart TV", e: "📺" }, { n: "Smartwatch", e: "⌚" }, { n: "Audio", e: "🔊" },
        ].map(c => (
          <a key={c.n} href="#" style={{ background: "#fff", border: "1px solid var(--li-border)", borderRadius: 16, padding: 18, textDecoration: "none", color: "var(--li-fg-1)", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", transition: "all 200ms var(--li-ease)" }}
             onMouseEnter={e => { e.currentTarget.style.boxShadow = "var(--li-shadow-md)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
             onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#F4F4F4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, filter: "grayscale(1)", opacity: 0.7 }}>{c.e}</div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{c.n}</span>
            <span style={{ fontSize: 12, color: "var(--li-fg-3)" }}>Ver productos →</span>
          </a>
        ))}
      </div>
    </section>

    {/* ============ TOP SELLERS ============ */}
    <section style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div>
          <Badge pixel tone="green" style={{ marginBottom: 8 }}>[ TOP_SELLERS ]</Badge>
          <h2 className="li-h2" style={{ margin: 0 }}>Lo más vendido del mes</h2>
        </div>
        <a href="#" style={{ fontSize: 14, color: "var(--li-fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>Ver más →</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {CATALOG.slice(0,4).map(p => <ProductCard key={p.id} p={p} onOpen={onOpenProduct}/>)}
      </div>
    </section>

    {/* ============ CUOTAS BANNER ============ */}
    <section style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px" }}>
      <div style={{ background: "var(--li-green)", color: "var(--li-black)", borderRadius: 24, padding: "30px 40px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--li-black)", color: "var(--li-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconCard size={26}/>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="li-pixel" style={{ fontSize: 18, marginBottom: 4 }}>[ CUOTAS_SIN_INTERES ]</div>
          <div style={{ fontFamily: "var(--li-font-display)", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>Pagá hasta en 12 cuotas sin interés</div>
          <div style={{ fontSize: 14, marginTop: 6, opacity: 0.75 }}>Con Mercado Pago, Naranja X, Cuota Simple y tarjetas de crédito.</div>
        </div>
        <Button variant="dark" size="lg">Ver condiciones</Button>
      </div>
    </section>

    {/* ============ TRUST SECTION ============ */}
    <section style={{ background: "#fff", marginTop: 48, borderTop: "1px solid var(--li-border)", borderBottom: "1px solid var(--li-border)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 24px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 56, alignItems: "center" }}>
        <div>
          <Badge tone="neutral" style={{ marginBottom: 16 }}>Nosotros</Badge>
          <h2 className="li-h2" style={{ margin: "0 0 16px" }}>Somos el local de tecnología de Villa Santa Rosa. Hace 9 años.</h2>
          <p className="li-lead" style={{ marginTop: 0 }}>
            No somos un ecommerce anónimo. Nos conocés, nos ves en el pueblo y nos bancamos lo que vendemos. <b>Si algo falla, lo traés al local.</b> Así de simple.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 28 }}>
            {[
              { icon: <IconShield/>, t: "Garantía real", s: "Reclamo en local, no paquetes a Capital." },
              { icon: <IconTruck/>, t: "Envío a zona", s: "Villa Santa Rosa y Río Primero en 24 hs." },
              { icon: <IconMapPin/>, t: "Retirá hoy", s: "Llegás, pagás y te lo llevás." },
              { icon: <IconWhats/>, t: "WhatsApp humano", s: "Te atiende Lucas, no un bot." },
            ].map(f => (
              <div key={f.t} style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--li-black)", color: "var(--li-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.t}</div>
                  <div style={{ fontSize: 12, color: "var(--li-fg-3)", marginTop: 2 }}>{f.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ aspectRatio: "4/3", background: "linear-gradient(135deg, #1A1A1A, #0A0A0A)", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "#3A3A3A", fontSize: 14, fontFamily: "var(--li-font-mono)", position: "relative", overflow: "hidden" }}>
            <span style={{ position: "absolute", top: 14, left: 14, ...pixelTag }}>[ FOTO_DEL_LOCAL.jpg ]</span>
            <div style={{ fontSize: 88 }}>🏪</div>
            <span style={{ position: "absolute", bottom: 14, right: 14, background: "rgba(255,255,255,0.9)", color: "var(--li-black)", padding: "6px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: "var(--li-font-sans)" }}>Belgrano 847 · VSR</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
            {[
              { name: "María G.", text: "Compré un celu por acá, me lo entregaron al día siguiente. 10/10.", stars: 5 },
              { name: "Diego R.", text: "Me asesoró bárbaro con la notebook. Precio mejor que Mercado Libre.", stars: 5 },
              { name: "Luciana F.", text: "El TV me llegó perfecto y en cuotas fijas. Recomiendo.", stars: 5 },
            ].map(r => (
              <div key={r.name} style={{ background: "var(--li-bg)", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 2, color: "var(--li-green)", marginBottom: 6 }}>{[...Array(r.stars)].map((_,i) => <IconStar key={i} size={12}/>)}</div>
                <p style={{ fontSize: 12, lineHeight: 1.5, margin: "0 0 8px", color: "var(--li-fg-2)" }}>"{r.text}"</p>
                <span style={{ fontSize: 11, color: "var(--li-fg-3)", fontWeight: 600 }}>— {r.name} · Google</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  </main>
);

const pixelTag = { fontFamily: "var(--li-font-pixel)", fontSize: 14, background: "var(--li-green)", color: "var(--li-black)", padding: "2px 8px", borderRadius: 4 };

window.Home = Home;
