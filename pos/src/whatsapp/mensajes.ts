/**
 * Los mensajes de WhatsApp: que dice cada uno, a quien va y cuando se repite.
 *
 * El POS arma el texto y deja el chat abierto con el mensaje escrito; quien
 * aprieta enviar es la persona (ver `enlace.ts` y `plantillas.ts`). Por eso
 * todo lo que se guarda dice «preparado»: el sistema sabe que se armo, no que
 * llego.
 *
 * Dos reglas que valen la pena:
 *
 *  - **Sin telefono no hay boton.** Antes que ofrecer algo que despues falla,
 *    la pantalla dice por que no se puede y ofrece cargar el numero.
 *  - **El recordatorio de deuda tiene freno.** Se le puede recordar al mismo
 *    cliente una vez cada tantos dias (`diasEntreRecordatorios`). Un cliente
 *    que debe $5.000 y recibe tres mensajes en una semana no paga antes: deja
 *    de comprar.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { whatsappMessages } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import { NEGOCIO_POR_DEFECTO } from '@/ventas/ticket';
import { ajustesDeWhatsApp, type AjustesDeWhatsApp } from './config';
import { enlaceDeWhatsApp } from './enlace';
import { acortarDetalle, nombreDePila, renderizar, type TipoDeMensaje } from './plantillas';

export interface MensajePreparado {
  tipo: TipoDeMensaje;
  clienteId: string;
  /** Como se llama, para que la pantalla diga a quien le va a escribir. */
  nombre: string;
  /** E.164, tal cual quedo normalizado al cargar el cliente. */
  telefono: string;
  texto: string;
  /** La URL de `wa.me` lista para poner en un enlace. */
  enlace: string;
  referenciaTipo: 'venta' | 'cuenta';
  referenciaId: string;
}

/**
 * O el mensaje esta listo, o hay un motivo en castellano para mostrar.
 *
 * Devolver el motivo en vez de tirar excepcion es a proposito: no poder
 * mandarle WhatsApp a alguien es lo normal (mostrador sin cliente cargado), no
 * un error.
 */
export type Preparacion =
  | { listo: true; mensaje: MensajePreparado }
  | { listo: false; codigo: MotivoSinMensaje; motivo: string };

/**
 * Por que no hay mensaje.
 *
 * El codigo lo usa la pantalla para decidir si vale la pena decir algo: que una
 * venta de mostrador no tenga cliente es lo comun y no se avisa; que el cliente
 * este cargado y le falte el telefono si, porque eso se arregla.
 */
export type MotivoSinMensaje =
  | 'no_existe'
  | 'anulada'
  | 'sin_cliente'
  | 'sin_telefono'
  | 'sin_deuda';

/* -------------------------------------------------------------------------- */
/* Comprobante de una venta                                                   */
/* -------------------------------------------------------------------------- */

interface FilaVenta {
  id: string;
  numero: string;
  fecha: string | Date;
  total_centavos: string | number;
  estado: 'completed' | 'cancelled';
  cliente_id: string | null;
  nombre: string | null;
  telefono: string | null;
  detalle: string | null;
  fiado_centavos: string | number | null;
}

function ventasParaComprobante(db: BaseDatos, ventaIds: string[]) {
  return db.execute(sql`
    SELECT s.id, s.numero, s.fecha, s.total_centavos, s.estado,
           c.id AS cliente_id, c.nombre, c.telefono,
           (SELECT string_agg(
                     CASE WHEN i.cantidad > 1
                          THEN i.cantidad || ' × ' || i.descripcion
                          ELSE i.descripcion END,
                     chr(10) ORDER BY i.descripcion)
              FROM sale_items i WHERE i.sale_id = s.id) AS detalle,
           (SELECT COALESCE(SUM(p.monto_centavos), 0)
              FROM sale_payments p
             WHERE p.sale_id = s.id AND p.medio = 'cuenta_corriente') AS fiado_centavos
      FROM sales s
      LEFT JOIN customers c ON c.id = s.cliente_id
     WHERE s.id IN (${sql.join(
       ventaIds.map((id) => sql`${id}`),
       sql`, `,
     )})
  `);
}

function comprobanteDe(v: FilaVenta, cfg: AjustesDeWhatsApp): Preparacion {
  if (v.estado === 'cancelled') {
    return {
      listo: false,
      codigo: 'anulada',
      motivo: 'La venta está anulada: no se manda comprobante.',
    };
  }
  if (!v.cliente_id || !v.nombre) {
    return { listo: false, codigo: 'sin_cliente', motivo: 'La venta no tiene cliente cargado.' };
  }
  if (!v.telefono) {
    return {
      listo: false,
      codigo: 'sin_telefono',
      motivo: `${v.nombre} no tiene teléfono cargado.`,
    };
  }

  // Lo que se llevó fiado se dice en el mensaje: es el comprobante que el
  // cliente guarda, y «gracias por tu compra» a secas esconde una deuda.
  const fiadoCentavos = Number(v.fiado_centavos ?? 0);

  const texto = renderizar(cfg.comprobante, {
    cliente: nombreDePila(v.nombre),
    local: NEGOCIO_POR_DEFECTO.nombre,
    numero: v.numero,
    total: formatearARS(Number(v.total_centavos)),
    detalle: v.detalle === null ? null : acortarDetalle(v.detalle),
    fecha: formatearFecha(new Date(v.fecha)),
    fiado:
      fiadoCentavos > 0
        ? `Quedaste debiendo ${formatearARS(fiadoCentavos)} de esta compra.`
        : null,
  });

  return {
    listo: true,
    mensaje: {
      tipo: 'comprobante',
      clienteId: v.cliente_id,
      nombre: v.nombre,
      telefono: v.telefono,
      texto,
      enlace: enlaceDeWhatsApp(v.telefono, texto),
      referenciaTipo: 'venta',
      referenciaId: v.id,
    },
  };
}

export async function armarComprobante(
  db: BaseDatos,
  ventaId: string,
  ajustes?: AjustesDeWhatsApp,
): Promise<Preparacion> {
  const [v] = filasDe<FilaVenta>(await ventasParaComprobante(db, [ventaId]));
  if (!v) return { listo: false, codigo: 'no_existe', motivo: 'No se encuentra esa venta.' };

  return comprobanteDe(v, ajustes ?? (await ajustesDeWhatsApp(db)));
}

/**
 * Los comprobantes de varias ventas de una.
 *
 * La pantalla de ventas del turno muestra veinte o treinta filas y cada una
 * necesita su enlace: es una consulta, no una por fila.
 */
export async function armarComprobantes(
  db: BaseDatos,
  ventaIds: string[],
  ajustes?: AjustesDeWhatsApp,
): Promise<Map<string, Preparacion>> {
  const mapa = new Map<string, Preparacion>();
  if (ventaIds.length === 0) return mapa;

  const cfg = ajustes ?? (await ajustesDeWhatsApp(db));
  for (const v of filasDe<FilaVenta>(await ventasParaComprobante(db, ventaIds))) {
    mapa.set(String(v.id), comprobanteDe(v, cfg));
  }

  return mapa;
}

/* -------------------------------------------------------------------------- */
/* Recordatorio de deuda                                                      */
/* -------------------------------------------------------------------------- */

interface FilaDeuda {
  id: string;
  nombre: string;
  telefono: string | null;
  saldo_centavos: string | number | null;
  ultimo: string | Date | null;
}

/** Los datos que hacen falta para armar el recordatorio, vengan de donde vengan. */
export interface DeudaParaRecordar {
  customerId: string;
  nombre: string;
  telefono: string | null;
  saldoCentavos: number;
  ultimoMovimiento: Date | null;
}

/**
 * Arma el recordatorio con datos que la pantalla ya tiene.
 *
 * La lista de fiado trae nombre, telefono, saldo y ultima actividad de todos
 * los deudores en una consulta: no hace falta volver a preguntar por cada uno.
 */
export function recordatorioDe(d: DeudaParaRecordar, cfg: AjustesDeWhatsApp): Preparacion {
  if (d.saldoCentavos <= 0) {
    return { listo: false, codigo: 'sin_deuda', motivo: `${d.nombre} no debe nada.` };
  }
  if (!d.telefono) {
    return {
      listo: false,
      codigo: 'sin_telefono',
      motivo: `${d.nombre} no tiene teléfono cargado.`,
    };
  }

  const texto = renderizar(cfg.recordatorio_fiado, {
    cliente: nombreDePila(d.nombre),
    local: NEGOCIO_POR_DEFECTO.nombre,
    deuda: formatearARS(d.saldoCentavos),
    desde: d.ultimoMovimiento ? formatearFecha(d.ultimoMovimiento) : null,
  });

  return {
    listo: true,
    mensaje: {
      tipo: 'recordatorio_fiado',
      clienteId: d.customerId,
      nombre: d.nombre,
      telefono: d.telefono,
      texto,
      enlace: enlaceDeWhatsApp(d.telefono, texto),
      referenciaTipo: 'cuenta',
      referenciaId: d.customerId,
    },
  };
}

export async function armarRecordatorio(
  db: BaseDatos,
  customerId: string,
  ajustes?: AjustesDeWhatsApp,
): Promise<Preparacion> {
  const [c] = filasDe<FilaDeuda>(
    await db.execute(sql`
      SELECT c.id, c.nombre, c.telefono,
             a.saldo_centavos,
             GREATEST(
               COALESCE((SELECT max(s.fecha) FROM sales s
                          WHERE s.cliente_id = c.id AND s.tipo = 'fiado'
                            AND s.estado = 'completed'), a.created_at),
               COALESCE((SELECT max(p.fecha) FROM credit_payments p
                          WHERE p.credit_account_id = a.id), a.created_at)
             ) AS ultimo
        FROM customers c
        LEFT JOIN credit_accounts a ON a.customer_id = c.id
       WHERE c.id = ${customerId}
    `),
  );

  if (!c) return { listo: false, codigo: 'no_existe', motivo: 'No se encuentra ese cliente.' };

  return recordatorioDe(
    {
      customerId: String(c.id),
      nombre: String(c.nombre),
      telefono: c.telefono,
      saldoCentavos: Number(c.saldo_centavos ?? 0),
      ultimoMovimiento: c.ultimo ? new Date(c.ultimo) : null,
    },
    ajustes ?? (await ajustesDeWhatsApp(db)),
  );
}

/** Arma el mensaje que corresponda, para que la accion no repita el `switch`. */
export function armar(
  db: BaseDatos,
  tipo: TipoDeMensaje,
  referenciaId: string,
): Promise<Preparacion> {
  return tipo === 'comprobante'
    ? armarComprobante(db, referenciaId)
    : armarRecordatorio(db, referenciaId);
}

/* -------------------------------------------------------------------------- */
/* Registro                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deja constancia de que el mensaje se preparo.
 *
 * Guarda el texto entero, no la plantilla: dentro de seis meses la plantilla va
 * a ser otra y lo que importa es que se le dijo a esa persona ese dia.
 */
export async function registrarPreparado(
  db: BaseDatos,
  datos: { mensaje: MensajePreparado; usuarioId: string },
): Promise<void> {
  const m = datos.mensaje;
  await db.insert(whatsappMessages).values({
    tipo: m.tipo,
    customerId: m.clienteId,
    telefono: m.telefono,
    texto: m.texto,
    referenciaTipo: m.referenciaTipo,
    referenciaId: m.referenciaId,
    preparadoPorId: datos.usuarioId,
  });
}

/* -------------------------------------------------------------------------- */
/* Freno de repeticion                                                        */
/* -------------------------------------------------------------------------- */

export interface UltimoAviso {
  fecha: Date;
  /** Dias enteros desde el aviso, para escribir «hace 3 días». */
  hace: number;
  /** True si todavia no paso la ventana configurada. */
  reciente: boolean;
}

function haceDias(fecha: Date): number {
  return Math.floor((Date.now() - fecha.getTime()) / 86_400_000);
}

/**
 * Cuando se le recordo la deuda por ultima vez a cada cliente de la lista.
 *
 * De a muchos y no de a uno porque la pantalla de fiado muestra a todos los
 * deudores juntos: una consulta, no una por fila.
 */
export async function ultimosRecordatorios(
  db: BaseDatos,
  customerIds: string[],
  diasEntreRecordatorios: number,
): Promise<Map<string, UltimoAviso>> {
  const mapa = new Map<string, UltimoAviso>();
  if (customerIds.length === 0) return mapa;

  const filas = await db
    .select({
      customerId: whatsappMessages.customerId,
      fecha: sql<Date>`max(${whatsappMessages.preparadoEn})`,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tipo, 'recordatorio_fiado'),
        inArray(whatsappMessages.customerId, customerIds),
      ),
    )
    .groupBy(whatsappMessages.customerId);

  for (const f of filas) {
    if (!f.customerId) continue;
    const fecha = new Date(f.fecha);
    const hace = haceDias(fecha);
    mapa.set(f.customerId, { fecha, hace, reciente: hace < diasEntreRecordatorios });
  }

  return mapa;
}

/** Lo mismo para un solo cliente. */
export async function ultimoRecordatorio(
  db: BaseDatos,
  customerId: string,
  diasEntreRecordatorios: number,
): Promise<UltimoAviso | null> {
  const mapa = await ultimosRecordatorios(db, [customerId], diasEntreRecordatorios);
  return mapa.get(customerId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Historial                                                                  */
/* -------------------------------------------------------------------------- */

export interface MensajeEnHistorial {
  id: string;
  tipo: TipoDeMensaje;
  nombre: string | null;
  telefono: string;
  texto: string;
  preparadoEn: Date;
  preparadoPor: string | null;
}

/** Los ultimos mensajes preparados, del mas nuevo al mas viejo. */
export async function historial(db: BaseDatos, limite = 50): Promise<MensajeEnHistorial[]> {
  const filas = filasDe<{
    id: string;
    tipo: TipoDeMensaje;
    nombre: string | null;
    telefono: string;
    texto: string;
    preparado_en: string | Date;
    preparado_por: string | null;
  }>(
    await db.execute(sql`
      SELECT m.id, m.tipo, c.nombre, m.telefono, m.texto, m.preparado_en,
             u.nombre AS preparado_por
        FROM whatsapp_messages m
        LEFT JOIN customers c ON c.id = m.customer_id
        LEFT JOIN users u ON u.id = m.preparado_por_id
       ORDER BY m.preparado_en DESC
       LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    tipo: f.tipo,
    nombre: f.nombre,
    telefono: String(f.telefono),
    texto: String(f.texto),
    preparadoEn: new Date(f.preparado_en),
    preparadoPor: f.preparado_por,
  }));
}

/** Cuantos mensajes se prepararon de cada tipo en los ultimos `dias` dias. */
export async function resumen(
  db: BaseDatos,
  dias = 30,
): Promise<{ comprobantes: number; recordatorios: number }> {
  const desde = new Date(Date.now() - dias * 86_400_000);

  const [r] = await db
    .select({
      comprobantes:
        sql<number>`count(*) filter (where ${whatsappMessages.tipo} = 'comprobante')`.mapWith(
          Number,
        ),
      recordatorios:
        sql<number>`count(*) filter (where ${whatsappMessages.tipo} = 'recordatorio_fiado')`.mapWith(
          Number,
        ),
    })
    .from(whatsappMessages)
    .where(gte(whatsappMessages.preparadoEn, desde));

  return { comprobantes: r?.comprobantes ?? 0, recordatorios: r?.recordatorios ?? 0 };
}

/** Los mensajes de un cliente, para su ficha. */
export async function mensajesDe(
  db: BaseDatos,
  customerId: string,
  limite = 10,
): Promise<{ tipo: TipoDeMensaje; texto: string; preparadoEn: Date }[]> {
  return db
    .select({
      tipo: whatsappMessages.tipo,
      texto: whatsappMessages.texto,
      preparadoEn: whatsappMessages.preparadoEn,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.customerId, customerId))
    .orderBy(desc(whatsappMessages.preparadoEn))
    .limit(limite);
}
