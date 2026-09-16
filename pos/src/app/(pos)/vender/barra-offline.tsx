'use client';

/**
 * Lo que la pantalla de venta dice del estado de la conexión (D56).
 *
 * Tres cosas distintas, y hay que poder distinguirlas de un vistazo desde el
 * otro lado del mostrador:
 *
 *  - **Sin conexión**: se puede seguir vendiendo, con el catálogo de hace un
 *    rato. Es información, no un error.
 *  - **Hay ventas esperando**: plata cobrada que el sistema todavía no tiene.
 *    Mientras haya una sola, el turno no se puede cerrar.
 *  - **Algo trabó la cola**: hay plata cobrada que no puede entrar sola. Es lo
 *    único de acá que pide que alguien haga algo ya.
 */
import { formatearARS } from '@/lib/dinero';
import { horasDesde, type Instantanea } from '@/offline/catalogo';

interface Props {
  hayConexion: boolean;
  catalogo: Instantanea | null;
  catalogoVieja: boolean;
  enCola: number;
  subiendo: boolean;
  trabada: string | null;
  avisos: string[];
  disponible: boolean;
  totalEnColaCentavos?: number;
  onSubir: () => void;
  onDescartarAvisos: () => void;
}

export default function BarraOffline({
  hayConexion,
  catalogo,
  catalogoVieja,
  enCola,
  subiendo,
  trabada,
  avisos,
  disponible,
  onSubir,
  onDescartarAvisos,
}: Props) {
  const nadaQueDecir =
    hayConexion && enCola === 0 && !trabada && avisos.length === 0 && disponible;
  if (nadaQueDecir) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {!disponible ? (
        <p
          role="alert"
          className="rounded-(--radius-caja) border-2 border-(--color-error) bg-(--color-error)/10 p-3 text-sm font-medium"
        >
          Este navegador no puede guardar nada: si se corta internet, no se va a poder vender. Usá
          la tablet de siempre, sin ventana privada.
        </p>
      ) : null}

      {!hayConexion ? (
        <div
          role="status"
          className="rounded-(--radius-caja) border-2 border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
        >
          <p className="font-semibold">Sin conexión. Se puede vender igual.</p>
          <p className="mt-0.5 text-(--color-tinta-suave)">
            {catalogo
              ? `Los precios y el stock son los de hace ${Math.round(horasDesde(catalogo.bajadaEn))} h. ` +
                'Cada venta se guarda acá y entra sola cuando vuelva internet.'
              : 'Todavía no se guardó ningún catálogo en esta tablet, así que el buscador va a estar vacío.'}
          </p>
          {catalogoVieja ? (
            <p className="mt-1 font-medium text-(--color-error)">
              Ojo: el catálogo guardado ya tiene muchas horas. El dólar se actualiza dos veces por
              día, así que un producto en dólares puede estar a un precio viejo.
            </p>
          ) : null}
        </div>
      ) : null}

      {enCola > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-marca)/8 p-3 text-sm"
        >
          <span className="font-semibold">
            {enCola} {enCola === 1 ? 'venta cobrada espera' : 'ventas cobradas esperan'} para entrar.
          </span>
          <span className="text-(--color-tinta-suave)">
            No cierres el turno hasta que no quede ninguna.
          </span>
          {hayConexion ? (
            <button
              type="button"
              onClick={onSubir}
              disabled={subiendo}
              className="ml-auto min-h-9 rounded-(--radius-caja) border border-(--color-marca) px-3 font-medium disabled:opacity-60"
            >
              {subiendo ? 'Subiendo…' : 'Subirlas ahora'}
            </button>
          ) : null}
        </div>
      ) : null}

      {trabada ? (
        <p
          role="alert"
          className="rounded-(--radius-caja) border-2 border-(--color-error) bg-(--color-error)/10 p-3 text-sm"
        >
          <strong>Hay plata cobrada que no puede entrar sola:</strong> {trabada} Avisale al dueño
          antes de cerrar el turno.
        </p>
      ) : null}

      {avisos.length > 0 ? (
        <div
          role="alert"
          className="rounded-(--radius-caja) border-2 border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
        >
          <p className="font-semibold">Entraron ventas con algo para mirar:</p>
          <ul className="mt-1 list-disc pl-5">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onDescartarAvisos}
            className="mt-2 text-(--color-tinta-suave) underline underline-offset-2"
          >
            Entendido
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Formatea un total de la cola. Se exporta para poder probar el texto. */
export function textoDeLaCola(cantidad: number, totalCentavos: number): string {
  if (cantidad === 0) return 'No queda ninguna venta esperando.';
  return `${cantidad} ${cantidad === 1 ? 'venta' : 'ventas'} por ${formatearARS(totalCentavos)}`;
}
