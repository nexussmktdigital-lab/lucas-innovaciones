'use client';

import { useState, useTransition } from 'react';
import { registrarPreparadoAccion } from '@/app/acciones-whatsapp';
import type { TipoDeMensaje } from '@/whatsapp/plantillas';

/**
 * El boton que abre WhatsApp con el mensaje escrito.
 *
 * Es un enlace de verdad y no un boton con `window.open`: el navegador abre la
 * pestana con el mismo clic de la persona, sin esperar al servidor, asi que no
 * hay pop-up bloqueado ni demora. La constancia se manda despues y por
 * separado; si esa parte falla, el mensaje igual se abrio.
 *
 * Cuando hay un aviso —«a este cliente ya se le recordo hace 2 dias»— el primer
 * clic no abre nada: muestra el aviso y pide confirmar. Es el freno para no
 * perseguir a nadie.
 */
export default function BotonWhatsApp({
  tipo,
  referenciaId,
  enlace,
  etiqueta,
  motivo = null,
  aviso = null,
  destacado = false,
}: {
  tipo: TipoDeMensaje;
  referenciaId: string;
  enlace: string;
  etiqueta: string;
  /** Por que no se puede mandar. Si viene, no hay enlace: hay explicacion. */
  motivo?: string | null;
  /** Advertencia previa que hay que confirmar antes de abrir el chat. */
  aviso?: string | null;
  destacado?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [anotado, setAnotado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, empezar] = useTransition();

  if (motivo) {
    return (
      <span
        title={motivo}
        className="cursor-not-allowed text-sm text-(--color-tinta-suave) opacity-70"
      >
        {etiqueta}: {motivo}
      </span>
    );
  }

  const clase = destacado
    ? 'inline-flex min-h-10 items-center rounded-(--radius-caja) border-[1.5px] border-(--color-marca) px-4 text-sm font-semibold'
    : 'text-sm font-medium underline underline-offset-2';

  function alHacerClic(e: React.MouseEvent<HTMLAnchorElement>) {
    if (aviso && !confirmando) {
      e.preventDefault();
      setConfirmando(true);
      return;
    }

    // Se deja andar el enlace: la pestana se abre con este mismo clic. La
    // constancia viaja en paralelo.
    empezar(async () => {
      const r = await registrarPreparadoAccion(tipo, referenciaId);
      if (r.error) setError(r.error);
      else setAnotado(true);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {aviso && confirmando ? (
        <span role="alert" className="text-xs font-medium text-(--color-alerta-tinta)">
          {aviso} ¿Le escribís igual?
        </span>
      ) : null}

      <a
        href={enlace}
        target="_blank"
        rel="noopener"
        onClick={alHacerClic}
        className={clase}
      >
        {aviso && confirmando ? `Sí, ${etiqueta.toLowerCase()}` : etiqueta}
      </a>

      {anotado ? (
        <span role="status" className="text-xs text-(--color-tinta-suave)">
          Preparado
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-(--color-error)">
          {error}
        </span>
      ) : null}
    </span>
  );
}
