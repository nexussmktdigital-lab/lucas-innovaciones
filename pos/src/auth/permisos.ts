/**
 * Permisos por rol.
 *
 * La regla del local, dicha por Lucas: **el vendedor puede hacer todo menos ver
 * los números del negocio**. Vender, fiar, descontar, anular, cargar un gasto,
 * dar de alta un producto, tocar precios: todo eso es atender el mostrador, y
 * frenarlo con un permiso lo único que lograba era que el vendedor tuviera que
 * ir a buscar al dueño con un cliente esperando.
 *
 * Por eso la lista que se escribe acá es la de las excepciones y no la de lo
 * permitido: así el permiso nuevo que alguien agregue mañana nace del lado del
 * vendedor, que es la regla, y volverlo del dueño es una decisión explícita.
 * `permisos.test.ts` obliga a clasificar cada permiso nuevo para que la
 * excepción no se cuele por olvido.
 *
 * Antes existía un tercer nivel —el vendedor puede, con el PIN del dueño al
 * lado— que nunca tuvo pantalla: `requiereAutorizacion` no se llamaba desde
 * ningún lado y los controles simplemente no se mostraban. Se fue con esto.
 */
export type Rol = 'owner' | 'seller';

export const PERMISOS = [
  'venta.crear',
  'venta.anular',
  'venta.descuento',
  'venta.editar_precio',
  'venta.forzar_ficha_dudosa',
  'fiado.cobrar',
  'fiado.crear',
  'stock.ver',
  'stock.ajustar',
  'caja.abrir',
  'caja.cerrar',
  'caja.retirar',
  'gasto.ver',
  'gasto.cargar',
  'producto.alta_rapida',
  'producto.editar',
  'reporte.ventas',
  'reporte.rentabilidad',
  'cotizacion.cambiar',
  'usuario.administrar',
  'configuracion.editar',
] as const;

export type Permiso = (typeof PERMISOS)[number];

/**
 * Lo único que no es del vendedor.
 *
 *  - Los dos de reportes son el balance del mes: facturación, márgenes, cuánto
 *    quedó. Es lo que Lucas quiere para él, y es lo único que pidió reservarse.
 *    Ojo que la pantalla de **Ventas** no está acá: el vendedor tiene que poder
 *    ver lo que vendió en el turno, y su hoja de cierre de caja también.
 *  - `usuario.administrar` no es trabajo de mostrador sino el control del
 *    sistema: crear cuentas y cambiar contraseñas, la del dueño incluida. Hoy
 *    no lo usa ninguna pantalla; queda reservado para que, el día que exista,
 *    no aparezca abierto sin que nadie lo haya decidido.
 *  - `venta.forzar_ficha_dudosa` es cobrar igual un producto cuya ficha está
 *    mal cargada: el iPhone con la cifra en dólares leída como pesos. No es
 *    una decisión de venta —nadie eligió ese precio— sino tapar un problema de
 *    catálogo, y lo que corresponde es arreglar la ficha. Escribir un precio a
 *    mano, que sí es del mostrador, no pasa por acá.
 */
const SOLO_DUENIO: readonly Permiso[] = [
  'reporte.ventas',
  'reporte.rentabilidad',
  'usuario.administrar',
  'venta.forzar_ficha_dudosa',
];

export function puede(rol: Rol, permiso: Permiso): boolean {
  return rol === 'owner' || !SOLO_DUENIO.includes(permiso);
}

/** Para el test que obliga a clasificar cada permiso nuevo. */
export const RESERVADOS_AL_DUENIO = SOLO_DUENIO;
