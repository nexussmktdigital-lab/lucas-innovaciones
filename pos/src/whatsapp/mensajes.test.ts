/**
 * Tests de los mensajes.
 *
 * Contra PGlite con las migraciones reales: lo que se prueba es que el mensaje
 * salga con los datos de la venta y de la deuda de verdad, y que el freno de
 * repeticion cuente los dias que tiene que contar.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { formatearARS } from '@/lib/dinero';
import {
  cashSessions,
  customers,
  monetaryAccounts,
  products,
  users,
  whatsappMessages,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { ajustesDeWhatsApp, guardarAjustesDeWhatsApp } from './config';
import {
  armarComprobante,
  armarComprobantes,
  armarRecordatorio,
  historial,
  registrarPreparado,
  resumen,
  ultimoRecordatorio,
} from './mensajes';
import { ErrorPlantilla, PLANTILLAS_POR_DEFECTO } from './plantillas';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;
let conTelefono: string;
let sinTelefono: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenioId = u!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  cajaId = c!.id;

  const [s] = await db
    .insert(cashSessions)
    .values({
      monetaryAccountId: cajaId,
      terminal: 'T1',
      abiertaPorId: duenioId,
      saldoInicialCentavos: 0,
    })
    .returning();
  sesionId = s!.id;

  const [p] = await db
    .insert(products)
    .values({ nombre: 'Vidrio templado 9D', precioCentavos: 500_000, stock: 100 })
    .returning();
  vidrioId = p!.id;

  const [a] = await db
    .insert(customers)
    .values({ nombre: 'Gabriela González', telefono: '+5493514567890', telefonoRaw: '3514567890' })
    .returning();
  conTelefono = a!.id;

  const [b] = await db.insert(customers).values({ nombre: 'Juan Pérez' }).returning();
  sinTelefono = b!.id;
});

async function vender(clienteId: string | undefined, opciones: { fiado?: boolean } = {}) {
  return confirmarVenta(db, {
    lineas: [{ productId: vidrioId, cantidad: 2 }],
    pagos: opciones.fiado
      ? [{ medio: 'cuenta_corriente', montoCentavos: 1_000_000 }]
      : [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
    clienteId,
    vendedorId: duenioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `v-${Math.random()}`,
  });
}

describe('comprobante', () => {
  it('sale con el número, el total, el detalle y el nombre de pila', async () => {
    const venta = await vender(conTelefono);
    const p = await armarComprobante(db, venta.id);

    expect(p.listo).toBe(true);
    if (!p.listo) return;

    expect(p.mensaje.texto).toContain('Hola Gabriela');
    expect(p.mensaje.texto).toContain(venta.numero);
    expect(p.mensaje.texto).toContain(formatearARS(1_000_000));
    expect(p.mensaje.texto).toContain('2 × Vidrio templado 9D');
    expect(p.mensaje.texto).toContain('Lucas Innovaciones');
    expect(p.mensaje.enlace).toContain('https://wa.me/5493514567890?text=');
  });

  it('una venta sin cliente no tiene a quién mandarle nada', async () => {
    const venta = await vender(undefined);
    const p = await armarComprobante(db, venta.id);

    expect(p.listo).toBe(false);
    if (p.listo) return;
    expect(p.codigo).toBe('sin_cliente');
  });

  it('un cliente sin teléfono se distingue de uno sin cargar', async () => {
    const venta = await vender(sinTelefono);
    const p = await armarComprobante(db, venta.id);

    expect(p.listo).toBe(false);
    if (p.listo) return;
    expect(p.codigo).toBe('sin_telefono');
    expect(p.motivo).toContain('Juan Pérez');
  });

  it('una venta anulada no manda comprobante', async () => {
    const venta = await vender(conTelefono);
    await anularVenta(db, { ventaId: venta.id, motivo: 'Se arrepintió', usuarioId: duenioId });

    const p = await armarComprobante(db, venta.id);
    expect(p.listo).toBe(false);
    if (p.listo) return;
    expect(p.codigo).toBe('anulada');
  });

  it('en lote arma uno por venta con una sola consulta', async () => {
    const a = await vender(conTelefono);
    const b = await vender(sinTelefono);

    const mapa = await armarComprobantes(db, [a.id, b.id]);

    expect(mapa.size).toBe(2);
    expect(mapa.get(a.id)?.listo).toBe(true);
    expect(mapa.get(b.id)?.listo).toBe(false);
  });

  it('sin ventas no consulta nada', async () => {
    expect((await armarComprobantes(db, [])).size).toBe(0);
  });
});

describe('recordatorio de deuda', () => {
  it('dice cuánto debe y desde cuándo', async () => {
    await vender(conTelefono, { fiado: true });
    const p = await armarRecordatorio(db, conTelefono);

    expect(p.listo).toBe(true);
    if (!p.listo) return;
    expect(p.mensaje.texto).toContain('Hola Gabriela');
    expect(p.mensaje.texto).toContain(formatearARS(1_000_000));
  });

  it('a quien no debe nada no se le recuerda nada', async () => {
    const p = await armarRecordatorio(db, conTelefono);

    expect(p.listo).toBe(false);
    if (p.listo) return;
    expect(p.codigo).toBe('sin_deuda');
  });

  it('con la deuda saldada deja de haber mensaje', async () => {
    await vender(conTelefono, { fiado: true });
    expect((await armarRecordatorio(db, conTelefono)).listo).toBe(true);

    // Se le cobra todo: el recordatorio no tiene más sentido.
    const { cobrarFiado } = await import('@/fiado/cuenta');
    await cobrarFiado(db, {
      customerId: conTelefono,
      montoCentavos: 1_000_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'c1',
    });

    expect((await armarRecordatorio(db, conTelefono)).listo).toBe(false);
  });
});

describe('constancia', () => {
  it('guarda el texto que se armó, no la plantilla', async () => {
    const venta = await vender(conTelefono);
    const p = await armarComprobante(db, venta.id);
    if (!p.listo) throw new Error('debería estar listo');

    await registrarPreparado(db, { mensaje: p.mensaje, usuarioId: duenioId });

    const [fila] = await db.select().from(whatsappMessages);
    expect(fila!.texto).toBe(p.mensaje.texto);
    expect(fila!.texto).toContain(venta.numero);
    expect(fila!.tipo).toBe('comprobante');
    expect(fila!.telefono).toBe('+5493514567890');
    expect(fila!.referenciaId).toBe(venta.id);
  });

  it('el historial trae el nombre del cliente y quién lo preparó', async () => {
    const venta = await vender(conTelefono);
    const p = await armarComprobante(db, venta.id);
    if (!p.listo) throw new Error('debería estar listo');
    await registrarPreparado(db, { mensaje: p.mensaje, usuarioId: duenioId });

    const [m] = await historial(db);
    expect(m!.nombre).toBe('Gabriela González');
    expect(m!.preparadoPor).toBe('Lucas');
  });

  it('el resumen cuenta por tipo', async () => {
    const venta = await vender(conTelefono);
    const c = await armarComprobante(db, venta.id);
    if (!c.listo) throw new Error('debería estar listo');
    await registrarPreparado(db, { mensaje: c.mensaje, usuarioId: duenioId });

    expect(await resumen(db)).toEqual({ comprobantes: 1, recordatorios: 0 });
  });
});

describe('freno de repetición', () => {
  it('sin avisos previos no hay freno', async () => {
    expect(await ultimoRecordatorio(db, conTelefono, 7)).toBeNull();
  });

  it('recién avisado, el aviso figura como reciente', async () => {
    await vender(conTelefono, { fiado: true });
    const p = await armarRecordatorio(db, conTelefono);
    if (!p.listo) throw new Error('debería estar listo');
    await registrarPreparado(db, { mensaje: p.mensaje, usuarioId: duenioId });

    const aviso = await ultimoRecordatorio(db, conTelefono, 7);
    expect(aviso?.hace).toBe(0);
    expect(aviso?.reciente).toBe(true);
  });

  it('pasada la ventana deja de frenar', async () => {
    await db.insert(whatsappMessages).values({
      tipo: 'recordatorio_fiado',
      customerId: conTelefono,
      telefono: '+5493514567890',
      texto: 'Hola',
      preparadoEn: new Date(Date.now() - 10 * 86_400_000),
    });

    const aviso = await ultimoRecordatorio(db, conTelefono, 7);
    expect(aviso?.hace).toBe(10);
    expect(aviso?.reciente).toBe(false);
  });

  it('un comprobante no frena el recordatorio: son otra cosa', async () => {
    await db.insert(whatsappMessages).values({
      tipo: 'comprobante',
      customerId: conTelefono,
      telefono: '+5493514567890',
      texto: 'Gracias por tu compra',
    });

    expect(await ultimoRecordatorio(db, conTelefono, 7)).toBeNull();
  });
});

describe('ajustes', () => {
  it('sin nada guardado usa los textos de fábrica', async () => {
    const a = await ajustesDeWhatsApp(db);
    expect(a.comprobante).toBe(PLANTILLAS_POR_DEFECTO.comprobante);
    expect(a.diasEntreRecordatorios).toBe(7);
  });

  it('lo guardado manda sobre el texto de fábrica', async () => {
    await guardarAjustesDeWhatsApp(db, {
      plantillas: {
        comprobante: 'Gracias {cliente}, son {total}',
        recordatorio_fiado: PLANTILLAS_POR_DEFECTO.recordatorio_fiado,
      },
      diasEntreRecordatorios: 15,
      usuarioId: duenioId,
    });

    const a = await ajustesDeWhatsApp(db);
    expect(a.comprobante).toBe('Gracias {cliente}, son {total}');
    expect(a.diasEntreRecordatorios).toBe(15);

    const venta = await vender(conTelefono);
    const p = await armarComprobante(db, venta.id);
    if (!p.listo) throw new Error('debería estar listo');
    expect(p.mensaje.texto).toBe(`Gracias Gabriela, son ${formatearARS(1_000_000)}`);
  });

  it('un campo inventado no se guarda', async () => {
    await expect(
      guardarAjustesDeWhatsApp(db, {
        plantillas: {
          comprobante: 'Hola {nombreDelPerro}',
          recordatorio_fiado: PLANTILLAS_POR_DEFECTO.recordatorio_fiado,
        },
        diasEntreRecordatorios: 7,
        usuarioId: duenioId,
      }),
    ).rejects.toBeInstanceOf(ErrorPlantilla);

    expect((await ajustesDeWhatsApp(db)).comprobante).toBe(PLANTILLAS_POR_DEFECTO.comprobante);
  });
});
