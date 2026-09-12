'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Rol } from '@/auth/permisos';

/**
 * Navegacion del POS.
 *
 * Los modulos que todavia no existen se muestran deshabilitados con la fase en
 * la que llegan, para que el equipo sepa que falta y no busque una pantalla que
 * no esta.
 */
const SECCIONES = [
  { href: '/', etiqueta: 'Inicio', tecla: 'F1', fase: 1 },
  { href: '/vender', etiqueta: 'Vender', tecla: 'F2', fase: 2 },
  { href: '/caja', etiqueta: 'Caja', tecla: 'F3', fase: 2 },
  { href: '/fiado', etiqueta: 'Fiado', tecla: 'F4', fase: 5 },
  { href: '/gastos', etiqueta: 'Gastos', tecla: 'F5', fase: 7 },
  { href: '/catalogo', etiqueta: 'Catálogo', tecla: 'F6', fase: 3, soloDuenio: true },
  { href: '/cotizacion', etiqueta: 'Dólar', tecla: 'F7', fase: 3, soloDuenio: true },
  { href: '/reportes', etiqueta: 'Reportes', tecla: 'F8', fase: 10, soloDuenio: true },
] as const;

const FASE_ACTUAL = 3;

export default function Navegacion({ rol }: { rol: Rol }) {
  const ruta = usePathname();

  return (
    <nav aria-label="Secciones" className="flex items-center gap-1">
      {SECCIONES.filter((s) => !('soloDuenio' in s && s.soloDuenio) || rol === 'owner').map((s) => {
        const disponible = s.fase <= FASE_ACTUAL;
        const activo = ruta === s.href;

        if (!disponible) {
          return (
            <span
              key={s.href}
              title={`Llega en la fase ${s.fase}`}
              className="cursor-not-allowed rounded-(--radius-caja) px-3 py-2 text-sm text-(--color-tinta-suave) opacity-45"
            >
              {s.etiqueta}
            </span>
          );
        }

        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={activo ? 'page' : undefined}
            className={`rounded-(--radius-caja) px-3 py-2 text-sm font-medium ${
              activo ? 'bg-(--color-marca) text-white' : 'hover:bg-(--color-papel)'
            }`}
          >
            {s.etiqueta}
            <kbd className="ml-1.5 text-xs opacity-60">{s.tecla}</kbd>
          </Link>
        );
      })}
    </nav>
  );
}
