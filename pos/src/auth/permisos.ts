/**
 * Permisos por rol.
 *
 * El dueno puede todo. El vendedor puede vender, cobrar fiado, consultar stock
 * y manejar su caja. Lo demas exige autorizacion del dueno con PIN en pantalla.
 */
export type Rol = 'owner' | 'seller';

export const PERMISOS = [
  'venta.crear',
  'venta.anular',
  'venta.descuento',
  'venta.editar_precio',
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

const DEL_VENDEDOR: readonly Permiso[] = [
  'venta.crear',
  'fiado.cobrar',
  'stock.ver',
  'caja.abrir',
  'caja.cerrar',
  'producto.alta_rapida',
];

/** Permisos que el vendedor puede ejercer si el dueno lo autoriza con su PIN. */
export const REQUIEREN_AUTORIZACION: readonly Permiso[] = [
  'venta.anular',
  'venta.descuento',
  'venta.editar_precio',
  'stock.ajustar',
  'gasto.cargar',
  'reporte.rentabilidad',
  'cotizacion.cambiar',
];

export function puede(rol: Rol, permiso: Permiso): boolean {
  return rol === 'owner' ? true : DEL_VENDEDOR.includes(permiso);
}

/** True si un vendedor puede hacerlo pidiendo el PIN del dueno. */
export function requiereAutorizacion(rol: Rol, permiso: Permiso): boolean {
  return rol !== 'owner' && REQUIEREN_AUTORIZACION.includes(permiso);
}
