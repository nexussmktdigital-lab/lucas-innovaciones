'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Rol } from '@/auth/permisos';

/**
 * Navegacion del POS.
 *
 * Los modulos que todavia no existen se muestran deshabilitados con la fase en
 * la que llegan, para que el equipo sepa que falta y no busque una pantalla que
 * no esta.
 *
 * Las teclas de funcion navegan de verdad: antes figuraban al lado de cada
 * seccion y no hacian nada, que es peor que no ponerlas. En una MacBook hay que
 * tener activado «usar F1, F2 como teclas de funcion estandar», o apretar Fn.
 */
const SECCIONES = [
  { href: '/', etiqueta: 'Inicio', tecla: 'F1', fase: 1 },
  { href: '/vender', etiqueta: 'Vender', tecla: 'F2', fase: 2 },
  { href: '/caja', etiqueta: 'Caja', tecla: 'F3', fase: 2 },
  { href: '/ventas', etiqueta: 'Ventas', tecla: 'F4', fase: 3 },
  { href: '/fiado', etiqueta: 'Fiado', tecla: 'F5', fase: 5 },
  { href: '/gastos', etiqueta: 'Gastos', tecla: 'F6', fase: 7 },
  { href: '/catalogo', etiqueta: 'Catálogo', tecla: 'F7', fase: 3, soloDuenio: true },
  { href: '/precios', etiqueta: 'Precios', tecla: 'F8', fase: 3, soloDuenio: true },
  { href: '/cotizacion', etiqueta: 'Dólar', tecla: 'F9', fase: 3, soloDuenio: true },
  { href: '/reportes', etiqueta: 'Reportes', tecla: 'F10', fase: 10, soloDuenio: true },
] as const;

const FASE_ACTUAL = 3;

export default function Navegacion({ rol }: { rol: Rol }) {
  const ruta = usePathname();
  const router = useRouter();

  const visibles = useMemo(
    () => SECCIONES.filter((s) => !('soloDuenio' in s && s.soloDuenio) || rol === 'owner'),
    [rol],
  );

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const destino = visibles.find((s) => s.tecla === e.key && s.fase <= FASE_ACTUAL);
      if (!destino) return;

      e.preventDefault();
      // Estando ya en la pantalla, la tecla se la deja a quien la use adentro:
      // en «Vender», F2 vuelve el foco al buscador.
      if (ruta !== destino.href) router.push(destino.href);
    }

    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [ruta, router, visibles]);

  return (
    <nav aria-label="Secciones" className="flex items-center gap-1">
      {visibles.map((s) => {
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
