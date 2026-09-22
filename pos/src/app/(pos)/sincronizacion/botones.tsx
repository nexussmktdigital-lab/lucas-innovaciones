'use client';

import { useState, useTransition } from 'react';
import {
  reintentarFallidasAccion,
  sincronizarAhoraAccion,
  type EstadoSincronizacion,
} from '@/app/acciones-sincronizacion';

export default function Botones({ hayFallidas }: { hayFallidas: boolean }) {
  const [estado, setEstado] = useState<EstadoSincronizacion>({});
  const [enCurso, empezar] = useTransition();

  function correr(accion: () => Promise<EstadoSincronizacion>) {
    setEstado({});
    empezar(async () => setEstado(await accion()));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={enCurso}
          onClick={() => correr(sincronizarAhoraAccion)}
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {enCurso ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>

        {hayFallidas ? (
          <button
            type="button"
            disabled={enCurso}
            onClick={() => correr(reintentarFallidasAccion)}
            className="min-h-11 rounded-(--radius-caja) border-2 border-(--color-error) px-4 font-semibold text-(--color-error) disabled:opacity-60"
          >
            Reintentar las fallidas
          </button>
        ) : null}
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}
    </div>
  );
}
