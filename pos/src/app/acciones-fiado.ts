'use server';

/**
 * Acciones de clientes y cuenta corriente.
 *
 * Fiar es dar credito y lo decide el dueno (`fiado.crear`). Cobrar lo puede
 * hacer el vendedor (`fiado.cobrar`): que alguien venga a pagar y no se le
 * pueda recibir la plata seria peor que cualquier control.
 */
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { config } from '@/lib/config';
import { aCentavos, ErrorDinero, formatearARS } from '@/lib/dinero';
import { sesionAbierta } from '@/caja/sesion';
import { crearCliente, editarCliente, ErrorCliente } from '@/clientes/clientes';
import { cobrarFiado, ErrorFiado, migrarFichaDePapel, ponerLimite } from '@/fiado/cuenta';
import { ErrorDevolucion, marcarDevuelta } from '@/fiado/devoluciones';

export interface EstadoFiado {
  error?: string;
  ok?: string;
  /** Id del cliente recién creado, para que la pantalla lo pueda seleccionar. */
  clienteId?: string;
}

const esquemaCliente = z.object({
  nombre: z.string().min(2).max(120),
  telefono: z.string().max(40).optional(),
  dni: z.string().max(20).optional(),
  email: z.string().max(120).optional(),
  direccion: z.string().max(200).optional(),
  notas: z.string().max(500).optional(),
});

function leerCliente(datos: FormData) {
  return esquemaCliente.safeParse({
    nombre: String(datos.get('nombre') ?? ''),
    telefono: String(datos.get('telefono') ?? ''),
    dni: String(datos.get('dni') ?? ''),
    email: String(datos.get('email') ?? ''),
    direccion: String(datos.get('direccion') ?? ''),
    notas: String(datos.get('notas') ?? ''),
  });
}

function refrescar() {
  revalidatePath('/clientes');
  revalidatePath('/fiado');
  revalidatePath('/vender');
  revalidatePath('/');
}

/**
 * Marca que se le devolvió al cliente la plata que había quedado en la caja.
 *
 * No mueve el cajón: sacar el efectivo es un acto de una persona y puede pasar
 * en otro turno o por otro medio del que entró. Esto cierra el recordatorio y
 * deja quién lo cerró.
 *
 * Lo puede hacer el vendedor: es el que está en el mostrador cuando el cliente
 * viene a buscar su plata, y no poder cerrarlo sería peor que el control.
 */
export async function marcarDevueltaAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };

  const id = String(datos.get('devolucionId') ?? '');
  if (!z.string().uuid().safeParse(id).success) {
    return { error: 'No se reconoce esa devolución.' };
  }

  try {
    const d = await marcarDevuelta(db, {
      id,
      usuarioId: sesion.user.id,
      nota: String(datos.get('nota') ?? '').trim() || null,
    });

    refrescar();
    return { ok: `Anotado: se le devolvieron ${formatearARS(d.montoCentavos)}.` };
  } catch (error) {
    if (error instanceof ErrorDevolucion) return { error: error.message };
    console.error('[fiado] Falló al marcar la devolución:', error);
    return { error: 'No se pudo registrar la devolución.' };
  }
}

export async function crearClienteAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };

  const validado = leerCliente(datos);
  if (!validado.success) return { error: 'Falta el nombre del cliente.' };

  try {
    const c = await crearCliente(db, validado.data);
    refrescar();
    return { ok: `«${c.nombre}» quedó cargado.`, clienteId: c.id };
  } catch (error) {
    if (error instanceof ErrorCliente) return { error: error.message };
    console.error('[clientes] Falló el alta:', error);
    return { error: 'No se pudo cargar el cliente.' };
  }
}

export async function editarClienteAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };

  const id = String(datos.get('clienteId') ?? '');
  if (!z.string().uuid().safeParse(id).success) return { error: 'No se reconoce ese cliente.' };

  const validado = leerCliente(datos);
  if (!validado.success) return { error: 'Falta el nombre del cliente.' };

  try {
    await editarCliente(db, id, validado.data);
    refrescar();
    return { ok: 'Datos guardados.' };
  } catch (error) {
    if (error instanceof ErrorCliente) return { error: error.message };
    console.error('[clientes] Falló la edición:', error);
    return { error: 'No se pudieron guardar los datos.' };
  }
}

const mediosDeCobro = z.enum([
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'mercadopago',
  'cheque',
]);

/**
 * Cobra a cuenta de una deuda. La plata entra a la caja del turno, así que hace
 * falta que haya una caja abierta: si no, el arqueo del día no cerraría.
 */
export async function cobrarFiadoAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'fiado.cobrar')) {
    return { error: 'No tenés permiso para cobrar fiado.' };
  }

  const customerId = String(datos.get('clienteId') ?? '');
  if (!z.string().uuid().safeParse(customerId).success) {
    return { error: 'No se reconoce ese cliente.' };
  }

  const medio = mediosDeCobro.safeParse(String(datos.get('medio') ?? 'efectivo'));
  if (!medio.success) return { error: 'Ese medio de pago no sirve para cobrar fiado.' };

  let montoCentavos: number;
  try {
    montoCentavos = aCentavos(String(datos.get('monto') ?? ''));
  } catch (error) {
    return {
      error: error instanceof ErrorDinero ? 'Escribí cuánto está pagando.' : 'Monto inválido.',
    };
  }

  const caja = await sesionAbierta(db, config().POS_TERMINAL);
  if (!caja) {
    return { error: 'No hay una caja abierta. Abrila antes de recibir la plata.' };
  }

  try {
    const r = await cobrarFiado(db, {
      customerId,
      montoCentavos,
      medio: medio.data,
      cashSessionId: caja.id,
      usuarioId: sesion.user.id,
      // Una clave por envío: reintentar el formulario no cobra dos veces, y dos
      // pagos iguales el mismo día siguen siendo dos pagos.
      idempotencyKey: String(datos.get('clave') ?? randomUUID()),
      nota: String(datos.get('nota') ?? '').trim() || null,
    });

    refrescar();
    revalidatePath('/caja');

    /*
     * Un cobro que ya existía no se anuncia como cobrado.
     *
     * La clave de idempotencia está para que un reintento no cobre dos veces, y
     * eso funciona. Lo que no puede pasar es que la pantalla diga «Cobrado
     * $10.000» cuando no entró nada: el mostrador cree que cobró, al cajón le
     * sobra la plata y la deuda del cliente sigue arriba. Pasó de verdad —dos
     * pagos seguidos desde la misma tarjeta— y lo encontró el recorrido a mano.
     */
    if (r.yaExistia) {
      return {
        error:
          'Ese pago ya estaba registrado, así que no se cobró de nuevo. ' +
          'Si el cliente está pagando otra vez, recargá la pantalla y cargalo.',
      };
    }

    return {
      ok:
        r.saldoCentavos === 0
          ? `Cobrado ${formatearARS(r.montoCentavos)}. Quedó al día.`
          : `Cobrado ${formatearARS(r.montoCentavos)}. Le queda una deuda de ${formatearARS(r.saldoCentavos)}.`,
    };
  } catch (error) {
    if (error instanceof ErrorFiado) return { error: error.message };
    console.error('[fiado] Falló el cobro:', error);
    return { error: 'No se pudo registrar el cobro. No se tocó nada: probá de nuevo.' };
  }
}

/**
 * Carga el saldo de una ficha de papel.
 *
 * Es la puerta de entrada de la libreta al sistema, y por eso es del dueño: es
 * declarar una deuda que nadie más vio nacer.
 */
export async function migrarFichaAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'fiado.crear')) {
    return { error: 'Cargar una ficha de papel lo hace el dueño.' };
  }

  const customerId = String(datos.get('clienteId') ?? '');
  if (!z.string().uuid().safeParse(customerId).success) {
    return { error: 'No se reconoce ese cliente.' };
  }

  let saldoCentavos: number;
  try {
    saldoCentavos = aCentavos(String(datos.get('saldo') ?? ''));
  } catch {
    return { error: 'Escribí cuánto dice la libreta que debe.' };
  }

  try {
    const cuenta = await migrarFichaDePapel(db, {
      customerId,
      saldoCentavos,
      usuarioId: sesion.user.id,
      nota: String(datos.get('nota') ?? '').trim() || null,
    });

    refrescar();
    return { ok: `Ficha cargada: debe ${formatearARS(cuenta.saldoCentavos)}.` };
  } catch (error) {
    if (error instanceof ErrorFiado) return { error: error.message };
    console.error('[fiado] Falló la migración:', error);
    return { error: 'No se pudo cargar la ficha.' };
  }
}

/** Pone o saca el tope de fiado de un cliente. Vacío es sin tope. */
export async function ponerLimiteAccion(
  _previo: EstadoFiado,
  datos: FormData,
): Promise<EstadoFiado> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'fiado.crear')) {
    return { error: 'El límite de fiado lo pone el dueño.' };
  }

  const customerId = String(datos.get('clienteId') ?? '');
  if (!z.string().uuid().safeParse(customerId).success) {
    return { error: 'No se reconoce ese cliente.' };
  }

  const crudo = String(datos.get('limite') ?? '').trim();
  let limiteCentavos: number | null = null;
  if (crudo !== '') {
    try {
      limiteCentavos = aCentavos(crudo);
    } catch {
      return { error: `«${crudo}» no es un monto.` };
    }
  }

  try {
    await ponerLimite(db, { customerId, limiteCentavos, usuarioId: sesion.user.id });
    refrescar();
    return {
      ok:
        limiteCentavos === null
          ? 'Sin tope: se le puede fiar lo que sea.'
          : `Tope de fiado en ${formatearARS(limiteCentavos)}.`,
    };
  } catch (error) {
    if (error instanceof ErrorFiado) return { error: error.message };
    console.error('[fiado] Falló el límite:', error);
    return { error: 'No se pudo guardar el límite.' };
  }
}
