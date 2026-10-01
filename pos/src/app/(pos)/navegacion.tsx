'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { puede, type Permiso, type Rol } from '@/auth/permisos';

/**
 * Navegación del POS.
 *
 * Trece secciones no entran en una barra, y menos en la tablet del mostrador.
 * Así que la barra lleva **las cinco de todos los días** —las mismas que usa el
 * vendedor— y el resto vive en un cajón agrupado por para qué sirve: la plata,
 * el catálogo y la atención al cliente. El dueño abre el cajón cuando necesita
 * algo de ahí, que es unas pocas veces por día; el vendedor no lo ve porque
 * ninguna de esas ocho es suya.
 *
 * Las teclas de función navegan de verdad, y siguen valiendo para lo que está
 * en el cajón: F6 abre Gastos aunque Gastos no esté a la vista. En una MacBook
 * hay que tener activado «usar F1, F2 como teclas de función estándar», o
 * apretar Fn.
 */
interface Seccion {
  href: string;
  etiqueta: string;
  tecla: string | null;
  /**
   * El permiso que hace falta para verla. Sin esto, la ven los dos roles.
   *
   * Antes acá decía `soloDuenio: true`, que escondía ocho de las nueve: la
   * barra decidía por rol y el modelo de permisos por permiso, así que abrirle
   * una pantalla al vendedor exigía acordarse de los dos lados. Ahora es uno.
   */
  permiso?: Permiso;
}

/** Las cinco que se tocan todo el día. Son las mismas para los dos roles. */
const PRINCIPALES: Seccion[] = [
  { href: '/', etiqueta: 'Inicio', tecla: 'F1' },
  { href: '/vender', etiqueta: 'Vender', tecla: 'F2' },
  { href: '/caja', etiqueta: 'Caja', tecla: 'F3' },
  { href: '/ventas', etiqueta: 'Ventas', tecla: 'F4' },
  { href: '/fiado', etiqueta: 'Fiado', tecla: 'F5' },
];

/**
 * El resto, agrupado por para qué sirve.
 *
 * El orden de los grupos no es casual: primero la plata, que es lo que el dueño
 * viene a mirar; después el catálogo, que se toca cuando llega mercadería; y al
 * final la atención, que son pantallas de rato libre.
 */
const GRUPOS: { titulo: string; items: Seccion[] }[] = [
  {
    titulo: 'Plata',
    items: [
      { href: '/gastos', etiqueta: 'Gastos', tecla: 'F6', permiso: 'gasto.ver' },
      { href: '/cuentas', etiqueta: 'Cuentas', tecla: null, permiso: 'gasto.ver' },
      // La única del cajón que el vendedor no ve: el balance del mes.
      { href: '/reportes', etiqueta: 'Reportes', tecla: 'F10', permiso: 'reporte.ventas' },
    ],
  },
  {
    titulo: 'Catálogo',
    items: [
      { href: '/catalogo', etiqueta: 'Catálogo', tecla: 'F7', permiso: 'producto.editar' },
      { href: '/precios', etiqueta: 'Precios', tecla: 'F8', permiso: 'producto.editar' },
      { href: '/cotizacion', etiqueta: 'Dólar', tecla: 'F9', permiso: 'cotizacion.cambiar' },
    ],
  },
  {
    titulo: 'Atención',
    items: [
      // Clientes también es del vendedor, pero entra desde Fiado: en la barra
      // ocuparía un lugar que se usa mucho menos que las cinco de arriba.
      { href: '/clientes', etiqueta: 'Clientes', tecla: null },
      { href: '/mensajes', etiqueta: 'Mensajes', tecla: null, permiso: 'configuracion.editar' },
      { href: '/devoluciones', etiqueta: 'Devoluciones', tecla: null, permiso: 'venta.anular' },
    ],
  },
];

const TODAS = [...PRINCIPALES, ...GRUPOS.flatMap((g) => g.items)];

export default function Navegacion({ rol }: { rol: Rol }) {
  const ruta = usePathname();
  const router = useRouter();
  const [cajon, setCajon] = useState(false);

  const grupos = useMemo(
    () =>
      GRUPOS.map((g) => ({
        ...g,
        items: g.items.filter((s) => !s.permiso || puede(rol, s.permiso)),
      })).filter((g) => g.items.length > 0),
    [rol],
  );

  const enElCajon = useMemo(() => grupos.flatMap((g) => g.items), [grupos]);
  const alcanzables = useMemo(
    () => [...PRINCIPALES, ...enElCajon],
    [enElCajon],
  );

  // El cajón se cierra al cambiar de pantalla: dejarlo abierto tapa media
  // pantalla de la que se acaba de abrir.
  useEffect(() => {
    setCajon(false);
  }, [ruta]);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') return setCajon(false);

      const destino = alcanzables.find((s) => s.tecla !== null && s.tecla === e.key);
      if (!destino) return;

      e.preventDefault();
      // Estando ya en la pantalla, la tecla se la deja a quien la use adentro:
      // en «Vender», F2 vuelve el foco al buscador.
      if (ruta !== destino.href) router.push(destino.href);
    }

    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [ruta, router, alcanzables]);

  const enUnGrupo = enElCajon.some((s) => s.href === ruta);

  return (
    <>
      <nav aria-label="Secciones" className="flex min-w-0 items-center gap-0.5">
        {PRINCIPALES.map((s) => (
          <Pestania key={s.href} seccion={s} activa={ruta === s.href} />
        ))}

        {enElCajon.length > 0 ? (
          <button
            type="button"
            onClick={() => setCajon((x) => !x)}
            aria-expanded={cajon}
            aria-controls="cajon-secciones"
            className={`ml-1 flex min-h-10 shrink-0 items-center gap-1.5 rounded-(--radius-caja) border border-(--color-barra-borde) px-3 text-sm font-semibold text-white ${
              cajon || enUnGrupo ? 'bg-(--color-barra-borde)' : ''
            }`}
          >
            Más
            <span className="text-xs text-(--color-barra-tinta)">{enElCajon.length}</span>
          </button>
        ) : null}
      </nav>

      {cajon ? (
        <div
          id="cajon-secciones"
          className="absolute inset-x-0 top-full z-40 border-t border-(--color-barra-borde) bg-(--color-barra) p-4 shadow-xl"
        >
          <div className="mx-auto grid max-w-7xl gap-4 sm:grid-cols-3">
            {grupos.map((g) => (
              <div key={g.titulo} className="flex flex-col gap-2">
                <p className="text-xs font-bold tracking-[0.08em] text-(--color-barra-tinta) uppercase">
                  {g.titulo}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      aria-current={ruta === s.href ? 'page' : undefined}
                      className={`flex min-h-10 items-center gap-1.5 rounded-(--radius-caja) border border-(--color-barra-borde) px-3 text-sm font-medium ${
                        ruta === s.href ? 'bg-white text-(--color-barra)' : 'text-white'
                      }`}
                    >
                      {s.etiqueta}
                      {s.tecla ? (
                        <kbd className="hidden font-mono text-xs text-(--color-barra-tinta) sm:inline">
                          {s.tecla}
                        </kbd>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Una de las cinco de la barra. La activa se invierte: fondo blanco, tinta negra. */
function Pestania({ seccion, activa }: { seccion: Seccion; activa: boolean }) {
  return (
    <Link
      href={seccion.href}
      aria-current={activa ? 'page' : undefined}
      className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-(--radius-caja) px-3 text-sm ${
        activa
          ? 'bg-white font-bold text-(--color-barra)'
          : 'font-medium text-white hover:bg-(--color-barra-borde)'
      }`}
    >
      {seccion.etiqueta}
      {seccion.tecla ? (
        <kbd
          className={`hidden font-mono text-xs sm:inline ${
            activa ? 'text-(--color-tinta-suave)' : 'text-(--color-barra-tinta)'
          }`}
        >
          {seccion.tecla}
        </kbd>
      ) : null}
    </Link>
  );
}

/** Las secciones que existen, para que otra pantalla pueda nombrarlas. */
export { TODAS as SECCIONES };
