import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { formatearFechaHora } from '@/lib/fecha';
import { ajustesDeWhatsApp } from '@/whatsapp/config';
import { historial, resumen } from '@/whatsapp/mensajes';
import FormularioPlantillas from './formulario-plantillas';

export const dynamic = 'force-dynamic';

/**
 * Mensajes de WhatsApp: qué dice el local y a quién ya le escribió.
 *
 * El texto es la voz del negocio, así que lo escribe el dueño y no queda
 * enterrado en el código. Abajo está lo que salió: sirve para ver si el
 * recordatorio de deuda se está usando de más.
 */
export default async function PaginaMensajes() {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const ajustes = await ajustesDeWhatsApp(db);
  const ultimos = await historial(db);
  const total = await resumen(db);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mensajes de WhatsApp</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          El sistema arma el mensaje y abre el chat con el texto ya escrito. Enviar lo aprieta la
          persona: por eso acá dice «preparado» y nunca «enviado».
        </p>
      </div>

      <FormularioPlantillas
        plantillas={{
          comprobante: ajustes.comprobante,
          recordatorio_fiado: ajustes.recordatorio_fiado,
          recordatorio_cuota: ajustes.recordatorio_cuota,
          recordatorio_atrasado: ajustes.recordatorio_atrasado,
        }}
        dias={ajustes.diasEntreRecordatorios}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Dato titulo="Comprobantes (30 días)" valor={total.comprobantes.toLocaleString('es-AR')} />
        <Dato
          titulo="Recordatorios de deuda (30 días)"
          valor={total.recordatorios.toLocaleString('es-AR')}
        />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Últimos mensajes preparados
        </h2>

        {ultimos.length === 0 ? (
          <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
            Todavía no se preparó ningún mensaje.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {ultimos.map((m) => (
              <li
                key={m.id}
                className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{m.nombre ?? m.telefono}</span>
                  <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs font-semibold text-(--color-tinta-suave)">
                    {m.tipo === 'comprobante' ? 'Comprobante' : 'Recordatorio'}
                  </span>
                  <span className="ml-auto text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(m.preparadoEn)}
                    {m.preparadoPor ? ` · ${m.preparadoPor}` : ''}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-(--color-tinta-media)">{m.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
    </div>
  );
}
