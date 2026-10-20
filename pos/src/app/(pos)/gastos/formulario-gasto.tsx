'use client';

import { useActionState, useEffect, useState } from 'react';
import { registrarGastoAccion, type EstadoGastos } from '@/app/acciones-gastos';
import { aCentavos, formatearARS, usdAPesosExacto } from '@/lib/dinero';

const INICIAL: EstadoGastos = {};

export const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'debito', etiqueta: 'Débito' },
  { valor: 'credito', etiqueta: 'Crédito' },
  { valor: 'cheque', etiqueta: 'Cheque' },
  { valor: 'dolares', etiqueta: 'Dólares (billetes)' },
] as const;

export interface Opcion {
  id: string;
  nombre: string;
}

/**
 * Cargar un gasto.
 *
 * Arranca en «ya lo pagué», que es el caso de todos los días: el flete, el
 * remís, lo que se le paga al técnico. «Todavía no» abre el vencimiento y
 * esconde el medio de pago, porque un gasto pendiente no salió de ningún lado.
 *
 * El monto se carga **en la moneda en que se pagó**. Los pagos a los
 * proveedores de iPhone son en dólares y hasta acá había que convertirlos a
 * mano antes de cargarlos: el gasto quedaba en pesos a la cotización que quien
 * cargaba recordara, y meses después no había forma de saber cuántos dólares
 * habían salido. Ahora se escriben los dólares y los pesos los calcula el
 * servidor con el dólar del día, congelados para siempre.
 */
export default function FormularioGasto({
  categorias,
  beneficiarios,
  cuentas,
  hoy,
  cotizacionCentavos,
}: {
  categorias: Opcion[];
  beneficiarios: Opcion[];
  cuentas: (Opcion & { tipo: string })[];
  hoy: string;
  /** El dólar del día, solo para mostrar a cuánto quedarían los pesos. */
  cotizacionCentavos: number | null;
}) {
  const [estado, accion, pendiente] = useActionState(registrarGastoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [pagado, setPagado] = useState(true);
  const [nuevoBeneficiario, setNuevoBeneficiario] = useState(false);
  const [enDolares, setEnDolares] = useState(false);
  const [medio, setMedio] = useState('efectivo');
  const [monto, setMonto] = useState('');

  const cuentaDeDolares = cuentas.find((c) => c.tipo === 'dolares');

  /*
   * Lo que van a ser en pesos, antes de guardar.
   *
   * No es el número que se guarda —ese lo calcula el servidor con la
   * cotización que lee él—, es para que quien carga vea si se equivocó de
   * tecla antes de confirmar: US$ 6.000 en vez de US$ 600 se nota mucho más
   * en pesos.
   */
  const enPesos = (() => {
    if (!enDolares || !cotizacionCentavos) return null;
    try {
      const usd = aCentavos(monto);
      return usd > 0 ? formatearARS(usdAPesosExacto(usd, cotizacionCentavos)) : null;
    } catch {
      return null;
    }
  })();

  // Guardado el gasto, el formulario se cierra: dejarlo abierto con los datos
  // adentro invita a cargar dos veces el mismo alquiler.
  useEffect(() => {
    if (estado.ok) {
      setAbierto(false);
      setNuevoBeneficiario(false);
      setEnDolares(false);
      setMedio('efectivo');
      setMonto('');
    }
  }, [estado.ok]);

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-5 font-semibold text-(--color-marca-texto)"
        >
          + Cargar un gasto
        </button>
        {estado.ok ? (
          <p role="status" className="text-sm font-medium text-(--color-ok)">
            {estado.ok}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={accion}
      aria-label="Cargar un gasto"
      className="space-y-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="¿En qué se gastó?" htmlFor="descripcion" className="sm:col-span-2">
          <input
            id="descripcion"
            name="descripcion"
            type="text"
            required
            minLength={3}
            maxLength={200}
            autoFocus
            placeholder="Ej.: flete de la mercadería de Córdoba"
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
          />
        </Campo>

        <Campo etiqueta="Cuánto" htmlFor="monto">
          <input type="hidden" name="moneda" value={enDolares ? 'USD' : 'ARS'} />
          <div className="flex">
            <span className="flex min-h-11 w-12 items-center justify-center rounded-l-(--radius-caja) border border-r-0 border-(--color-borde) bg-(--color-panel) text-sm font-semibold">
              {enDolares ? 'US$' : '$'}
            </span>
            <input
              id="monto"
              name="monto"
              type="text"
              inputMode="decimal"
              required
              placeholder="0"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="tabular min-h-11 w-full rounded-r-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const dolares = !enDolares;
              setEnDolares(dolares);
              /*
               * Un gasto en dólares casi siempre se paga con los billetes del
               * cajón verde: al proveedor de iPhones se le paga así. Queda
               * elegido y se puede cambiar, para no tener que tocar dos cosas
               * cuando se carga el caso de todos los días.
               */
              if (dolares && medio === 'efectivo') setMedio('dolares');
              if (!dolares && medio === 'dolares') setMedio('efectivo');
            }}
            className="mt-1 text-xs underline underline-offset-2"
          >
            {enDolares ? 'Lo pagué en pesos' : 'Lo pagué en dólares'}
          </button>
          {enDolares ? (
            <p className="mt-1 text-xs text-(--color-tinta-suave)">
              {enPesos
                ? `Son ${enPesos} al dólar de hoy. Quedan congelados: el gasto no cambia de monto cuando cambie el dólar.`
                : cotizacionCentavos
                  ? 'Escribí cuántos dólares salieron.'
                  : 'No hay cotización cargada: cargá el dólar del día antes de guardar este gasto.'}
            </p>
          ) : null}
        </Campo>

        <Campo etiqueta="Categoría" htmlFor="categoria">
          <select
            id="categoria"
            name="categoria"
            required
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Campo>

        <Campo etiqueta="Fecha" htmlFor="fecha">
          <input
            id="fecha"
            name="fecha"
            type="date"
            defaultValue={hoy}
            max={hoy}
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
          />
        </Campo>

        <Campo etiqueta="A quién" htmlFor={nuevoBeneficiario ? 'beneficiarioNuevo' : 'beneficiario'}>
          {nuevoBeneficiario ? (
            <input
              id="beneficiarioNuevo"
              name="beneficiarioNuevo"
              type="text"
              maxLength={120}
              autoFocus
              placeholder="Nombre del proveedor o técnico"
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
            />
          ) : (
            <select
              id="beneficiario"
              name="beneficiario"
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
            >
              <option value="">— Sin especificar —</option>
              {beneficiarios.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setNuevoBeneficiario((v) => !v)}
            className="mt-1 text-xs underline underline-offset-2"
          >
            {nuevoBeneficiario ? 'Elegir de la lista' : 'Es alguien nuevo'}
          </button>
        </Campo>
      </div>

      <fieldset className="rounded-(--radius-caja) bg-(--color-papel) p-3">
        <legend className="px-1 text-sm font-medium">¿Ya se pagó?</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="estado"
              value="pagado"
              checked={pagado}
              onChange={() => setPagado(true)}
            />
            Sí, ya salió la plata
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="estado"
              value="pendiente"
              checked={!pagado}
              onChange={() => setPagado(false)}
            />
            Todavía no
          </label>
        </div>

        {pagado ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Con qué" htmlFor="medio">
              <select
                id="medio"
                name="medio"
                value={medio}
                onChange={(e) => setMedio(e.target.value)}
                className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              >
                {MEDIOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="De qué cuenta salió" htmlFor="cuenta">
              <select
                id="cuenta"
                name="cuenta"
                /* Con billetes verdes, el cajón verde. Es la única cuenta de
                   la que puede salir: las demás llevan pesos. */
                key={medio === 'dolares' ? 'dolares' : 'pesos'}
                defaultValue={medio === 'dolares' ? cuentaDeDolares?.id : undefined}
                className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            {/* Solo con cheque, y solo mientras esté elegido: si se cambia el
                medio, los campos se desmontan y no viajan con lo demás. Un
                número de cheque colgado de una transferencia no significa
                nada, y la base lo rechaza. */}
            {medio === 'cheque' ? (
              <>
                <Campo etiqueta="Número de cheque" htmlFor="chequeNumero">
                  <input
                    id="chequeNumero"
                    name="chequeNumero"
                    type="text"
                    maxLength={40}
                    inputMode="numeric"
                    placeholder="Ej.: 00123456"
                    className="tabular min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
                  />
                </Campo>
                <Campo etiqueta="Cheque recibido de" htmlFor="chequeRecibidoDe">
                  <input
                    id="chequeRecibidoDe"
                    name="chequeRecibidoDe"
                    type="text"
                    maxLength={120}
                    placeholder="Quién nos dio el cheque"
                    className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
                  />
                </Campo>
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-3">
            <Campo etiqueta="¿Cuándo vence? (opcional)" htmlFor="vencimiento">
              <input
                id="vencimiento"
                name="vencimiento"
                type="date"
                className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
              />
            </Campo>
          </div>
        )}
      </fieldset>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) px-5 font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar el gasto'}
        </button>
      </div>
    </form>
  );
}

function Campo({
  etiqueta,
  htmlFor,
  className = '',
  children,
}: {
  etiqueta: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      {children}
    </div>
  );
}
