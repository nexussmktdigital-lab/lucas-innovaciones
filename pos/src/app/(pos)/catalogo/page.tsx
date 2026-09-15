import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { cotizacionVigente } from '@/cotizacion/cotizacion';
import {
  BLOQUEANTES,
  ETIQUETA,
  evaluarCatalogo,
  type TipoDeProblema,
} from '@/catalogo/calidad';
import { cuantasFichasPendientes, fichasPendientes } from '@/catalogo/crear';
import FichasPendientes from './fichas-pendientes';

export const dynamic = 'force-dynamic';

/** Cuántas fichas se listan. Más que esto no se arregla en una sentada. */
const TOPE = 60;

export default async function PaginaCatalogo({
  searchParams,
}: {
  searchParams: Promise<{ solo?: string; importados?: string }>;
}) {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const { solo, importados } = await searchParams;
  const soloBloqueantes = solo !== 'todo';
  const pendientes = await fichasPendientes(db);
  const totalPendientes = await cuantasFichasPendientes(db);

  const tc = await cotizacionVigente(db);
  const informe = await evaluarCatalogo(db, tc?.valorCentavos ?? null, {
    soloBloqueantes,
    limite: TOPE,
  });

  const sanos = informe.totalProductos - informe.conProblemas;
  const urlWoo = process.env.WOO_URL?.replace(/\/+$/, '') ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            Las fichas de WooCommerce se arreglan allá. Acá se ve cuáles y por qué, y se carga lo
            que todavía no está.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/catalogo/nuevo"
            className="min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-3 leading-10 font-semibold text-white"
          >
            Cargar un producto
          </Link>
          <Link
            href="/catalogo/importar"
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 leading-10 font-medium"
          >
            Importar planilla
          </Link>
        </div>
      </div>

      {/* Se renderiza desde el servidor y no como estado de la acción: la
          importación redirige acá, así que un `ok` del formulario no
          sobreviviría al cambio de pantalla. */}
      {importados ? (
        <p className="rounded-(--radius-caja) border-2 border-(--color-ok) bg-(--color-ok)/8 p-3 text-sm font-semibold text-(--color-ok)">
          Se cargaron {importados} productos de la planilla. Ya se pueden vender.
        </p>
      ) : null}

      <FichasPendientes fichas={pendientes} total={totalPendientes} wooUrl={urlWoo} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato titulo="Fichas revisadas" valor={informe.totalProductos.toLocaleString('es-AR')} />
        <Dato
          titulo="Impiden vender bien"
          valor={informe.conProblemasBloqueantes.toLocaleString('es-AR')}
          alerta={informe.conProblemasBloqueantes > 0}
          detalle="Precio sospechoso, dólar incoherente o sin precio"
        />
        <Dato
          titulo="Sin ningún problema"
          valor={sanos.toLocaleString('es-AR')}
          detalle={`${Math.round((sanos / Math.max(informe.totalProductos, 1)) * 100)}% del catálogo`}
        />
      </div>

      {informe.porTipo.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Por tipo de problema
          </h2>
          <ul className="flex flex-wrap gap-2">
            {informe.porTipo.map((t) => (
              <li
                key={t.tipo}
                className={`rounded-(--radius-caja) border px-3 py-1.5 text-sm ${
                  BLOQUEANTES.includes(t.tipo)
                    ? 'border-(--color-alerta) bg-(--color-alerta)/8'
                    : 'border-(--color-borde) bg-(--color-panel)'
                }`}
              >
                <span className="font-medium">{ETIQUETA[t.tipo]}</span>{' '}
                <span className="tabular text-(--color-tinta-suave)">{t.cantidad}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="flex gap-1.5 text-sm" aria-label="Filtro">
        <Filtro href="/catalogo" activo={soloBloqueantes}>
          Solo lo que impide vender
        </Filtro>
        <Filtro href="/catalogo?solo=todo" activo={!soloBloqueantes}>
          Todo, incluido fotos y SKU
        </Filtro>
      </nav>

      {informe.productos.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-ok) bg-(--color-ok)/8 p-6 text-center">
          {soloBloqueantes
            ? 'No hay ninguna ficha con un problema que impida vender bien.'
            : 'El catálogo está limpio.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {informe.productos.map((p) => (
            <li
              key={p.id}
              className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{p.nombre}</span>
                {p.sku ? (
                  <span className="text-xs text-(--color-tinta-suave)">{p.sku}</span>
                ) : null}
                {p.categoria ? (
                  <span className="text-xs text-(--color-tinta-suave)">· {p.categoria}</span>
                ) : null}
                <span className="tabular ml-auto font-semibold">
                  {formatearARS(p.precioCentavos)}
                  {p.precioUsdCentavos ? (
                    <span className="ml-1 text-xs font-normal text-(--color-tinta-suave)">
                      {formatearUSD(p.precioUsdCentavos)}
                    </span>
                  ) : null}
                </span>
              </div>

              <ul className="mt-2 flex flex-col gap-1">
                {p.problemas.map((x) => (
                  <li key={x.tipo} className="flex gap-2 text-sm">
                    <Chapa tipo={x.tipo} />
                    <span className="text-(--color-tinta-media)">{x.detalle}</span>
                  </li>
                ))}
              </ul>

              {urlWoo && p.wooId ? (
                <a
                  href={`${urlWoo}/wp-admin/post.php?post=${p.wooId}&action=edit`}
                  target="_blank"
                  rel="noopener"
                  className="mt-2 inline-block text-sm underline underline-offset-2"
                >
                  Abrir la ficha en WooCommerce
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {informe.conProblemas > TOPE && informe.productos.length === TOPE ? (
        <p className="text-center text-sm text-(--color-tinta-suave)">
          Se muestran las primeras {TOPE}. Arreglá estas, volvé a sincronizar y aparecen las
          siguientes.
        </p>
      ) : null}
    </div>
  );
}

function Filtro({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={activo ? 'page' : undefined}
      className={`min-h-9 rounded-(--radius-caja) border px-3 py-1.5 font-medium ${
        activo
          ? 'border-(--color-marca) bg-(--color-marca) text-white'
          : 'border-(--color-borde) bg-(--color-panel)'
      }`}
    >
      {children}
    </a>
  );
}

function Chapa({ tipo }: { tipo: TipoDeProblema }) {
  const bloqueante = BLOQUEANTES.includes(tipo);
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
        bloqueante
          ? 'bg-(--color-alerta)/15 text-(--color-alerta)'
          : 'bg-(--color-papel) text-(--color-tinta-suave)'
      }`}
    >
      {ETIQUETA[tipo]}
    </span>
  );
}

function Dato({
  titulo,
  valor,
  detalle,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-(--radius-caja) border bg-(--color-panel) p-4 ${
        alerta ? 'border-(--color-alerta)' : 'border-(--color-borde)'
      }`}
    >
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
