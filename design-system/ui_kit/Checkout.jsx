/* global React, Button, Badge, Price, StockDot,
   IconTruck, IconMapPin, IconCheck, IconCard, IconShield, IconWhats, IconChevronR */

const Checkout = ({ onBack }) => {
  const [delivery, setDelivery] = React.useState("local");
  const [pay, setPay] = React.useState("mp");
  const [step, setStep] = React.useState(1);

  const item = { name: "Galaxy A55 5G 256GB Awesome Navy", price: 1299000, qty: 1, emoji: "📱", brand: "Samsung" };
  const envio = delivery === "envio" ? 0 : 0;
  const total = item.price * item.qty + envio;

  return (
    <main style={{ background: "var(--li-bg)", minHeight: "calc(100vh - 60px)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 60px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32 }}>
        <div>
          <h1 className="li-h1" style={{ margin: "0 0 8px", fontSize: 30 }}>Finalizar compra</h1>
          <p className="li-small" style={{ margin: "0 0 24px" }}>3 pasos simples. Todo tu pedido está asegurado.</p>

          {/* Stepper */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24, background: "#fff", border: "1px solid var(--li-border)", borderRadius: 12, overflow: "hidden" }}>
            {[
              { n: 1, t: "Tus datos" },
              { n: 2, t: "Entrega" },
              { n: 3, t: "Pago" },
            ].map((s, i, arr) => (
              <button key={s.n} onClick={() => setStep(s.n)} style={{ flex: 1, padding: "14px 16px", border: "none", background: step === s.n ? "var(--li-black)" : "transparent", color: step === s.n ? "#fff" : "var(--li-fg-2)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit", fontSize: 14, fontWeight: 600, borderRight: i < arr.length - 1 ? "1px solid var(--li-border)" : "none" }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: step === s.n ? "var(--li-green)" : step > s.n ? "var(--li-green)" : "var(--li-bg)", color: step === s.n ? "var(--li-black)" : step > s.n ? "var(--li-black)" : "var(--li-fg-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {step > s.n ? <IconCheck size={14}/> : s.n}
                </span>
                {s.t}
              </button>
            ))}
          </div>

          {/* === STEP 1 === */}
          {step === 1 && (
            <Card title="Tus datos">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Nombre" value="Lucas"/>
                <Field label="Apellido" value="Pérez"/>
                <Field label="DNI" value="32.456.789"/>
                <Field label="Teléfono" value="+54 3574 443092"/>
                <Field label="Email" value="lucas@vsr.com.ar" full/>
              </div>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                <Button onClick={() => setStep(2)} iconRight={<IconChevronR size={16}/>}>Continuar</Button>
              </div>
            </Card>
          )}

          {/* === STEP 2 === */}
          {step === 2 && (
            <Card title="Forma de entrega">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <DeliveryOption on={delivery === "local"} onClick={() => setDelivery("local")} icon={<IconMapPin/>} title="Retiro en local" sub="Belgrano 847, VSR · Hoy desde 17:00" price="Gratis"/>
                <DeliveryOption on={delivery === "envio"} onClick={() => setDelivery("envio")} icon={<IconTruck/>} title="Envío a domicilio" sub="VSR y Río Primero · Mañana" price="Gratis"/>
              </div>
              {delivery === "envio" && (
                <div style={{ marginTop: 16, background: "var(--li-bg)", borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Dirección" value="Belgrano 1234" full/>
                  <Field label="Ciudad" value="Villa Santa Rosa"/>
                  <Field label="Código postal" value="5127"/>
                </div>
              )}
              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
                <Button variant="ghost" onClick={() => setStep(1)}>← Volver</Button>
                <Button onClick={() => setStep(3)} iconRight={<IconChevronR size={16}/>}>Continuar al pago</Button>
              </div>
            </Card>
          )}

          {/* === STEP 3 === */}
          {step === 3 && (
            <Card title="Forma de pago">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <PayOption on={pay === "mp"} onClick={() => setPay("mp")} title="Mercado Pago" sub="Hasta 12 cuotas sin interés · Tarjeta, efectivo en Pago Fácil, Rapipago" badge="Recomendado"/>
                <PayOption on={pay === "tra"} onClick={() => setPay("tra")} title="Transferencia bancaria" sub="Te mandamos los datos por WhatsApp · 5% de descuento"/>
                <PayOption on={pay === "ef"} onClick={() => setPay("ef")} title="Efectivo en el local" sub="Reservás online y pagás al retirar"/>
              </div>
              {pay === "mp" && (
                <div style={{ marginTop: 14, background: "var(--li-bg)", borderRadius: 12, padding: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[3,6,9,12].map(c => (
                    <button key={c} style={{ padding: "10px 14px", border: `1.5px solid ${c === 12 ? "var(--li-black)" : "var(--li-border-strong)"}`, background: "#fff", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: c === 12 ? 600 : 500 }}>
                      {c} cuotas de <b>$ {Math.round(1299000/c).toLocaleString("es-AR")}</b>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
                <Button variant="ghost" onClick={() => setStep(2)}>← Volver</Button>
                <Button size="lg" iconRight={<IconChevronR size={18}/>}>Confirmar compra · $ {total.toLocaleString("es-AR")}</Button>
              </div>
            </Card>
          )}

          {/* Trust row */}
          <div style={{ marginTop: 20, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--li-fg-3)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconShield size={14} style={{ color: "var(--li-green)" }}/> Compra protegida</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconCheck size={14} style={{ color: "var(--li-green)" }}/> Garantía Lucas 12 meses</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconWhats size={14} style={{ color: "var(--li-green)" }}/> Soporte por WhatsApp</span>
          </div>
        </div>

        {/* Sticky order summary */}
        <aside>
          <div style={{ position: "sticky", top: 100, background: "#fff", border: "1px solid var(--li-border)", borderRadius: 16, padding: 20 }}>
            <div className="li-eyebrow" style={{ marginBottom: 14 }}>Tu pedido</div>
            <div style={{ display: "flex", gap: 12, paddingBottom: 14, borderBottom: "1px dashed var(--li-border)" }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, background: "#F4F4F4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, filter: "grayscale(1)" }}>{item.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--li-fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{item.brand}</div>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{item.name}</div>
                <div style={{ fontSize: 12, color: "var(--li-fg-3)", marginTop: 4 }}>Cantidad: {item.qty}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>$ {(item.price * item.qty).toLocaleString("es-AR")}</div>
            </div>
            <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--li-fg-2)" }}>
              <Row k="Subtotal" v={`$ ${item.price.toLocaleString("es-AR")}`}/>
              <Row k={delivery === "local" ? "Retiro en local" : "Envío"} v="Gratis" vc="#00A63A"/>
              <Row k="12 cuotas sin interés" v={`$ ${Math.round(item.price/12).toLocaleString("es-AR")} / mes`} vc="#00A63A" small/>
            </div>
            <div style={{ paddingTop: 14, borderTop: "1px solid var(--li-border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--li-font-display)", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>$ {total.toLocaleString("es-AR")}</div>
                <div style={{ fontSize: 11, color: "var(--li-fg-3)" }}>IVA incluido</div>
              </div>
            </div>
            <div style={{ marginTop: 14, background: "var(--li-bg)", borderRadius: 10, padding: 10, fontSize: 11, color: "var(--li-fg-2)", display: "flex", gap: 8 }}>
              <IconCard size={16} style={{ color: "var(--li-green)", flexShrink: 0, marginTop: 1 }}/>
              <span>Al pagar con Mercado Pago, <b>12 cuotas sin interés</b> de <b style={{ color: "#00A63A" }}>$ {Math.round(item.price/12).toLocaleString("es-AR")}</b>.</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
};

const Card = ({ title, children }) => (
  <div style={{ background: "#fff", border: "1px solid var(--li-border)", borderRadius: 16, padding: 24, marginBottom: 16 }}>
    <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>{title}</h3>
    {children}
  </div>
);

const Field = ({ label, value, full }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: full ? "1 / -1" : "auto" }}>
    <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
    <input defaultValue={value} style={{ padding: "10px 12px", border: "1px solid var(--li-border-strong)", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none" }}/>
  </label>
);

const DeliveryOption = ({ on, onClick, icon, title, sub, price }) => (
  <button onClick={onClick} style={{ textAlign: "left", border: `1.5px solid ${on ? "var(--li-green)" : "var(--li-border-strong)"}`, background: on ? "#F5FFF7" : "#fff", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start", fontFamily: "inherit" }}>
    <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--li-black)", color: "var(--li-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--li-fg-3)", marginTop: 2 }}>{sub}</div>
    </div>
    <span style={{ fontSize: 13, fontWeight: 600, color: "#00A63A" }}>{price}</span>
  </button>
);

const PayOption = ({ on, onClick, title, sub, badge }) => (
  <button onClick={onClick} style={{ textAlign: "left", border: `1.5px solid ${on ? "var(--li-green)" : "var(--li-border-strong)"}`, background: on ? "#F5FFF7" : "#fff", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", gap: 12, alignItems: "center", fontFamily: "inherit" }}>
    <span style={{ width: 18, height: 18, borderRadius: "50%", border: `${on ? "5px" : "1.5px"} solid ${on ? "var(--li-green)" : "var(--li-border-strong)"}`, background: "#fff", flexShrink: 0 }}/>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
        {title}
        {badge && <Badge tone="green" style={{ fontSize: 10 }}>{badge}</Badge>}
      </div>
      <div style={{ fontSize: 12, color: "var(--li-fg-3)", marginTop: 2 }}>{sub}</div>
    </div>
  </button>
);

const Row = ({ k, v, vc, small }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: small ? 12 : 13 }}>
    <span style={{ color: "var(--li-fg-3)" }}>{k}</span>
    <span style={{ color: vc || "var(--li-fg-1)", fontWeight: 600 }}>{v}</span>
  </div>
);

window.Checkout = Checkout;
