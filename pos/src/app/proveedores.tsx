'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Estado del servidor en el cliente.
 *
 * `staleTime` corto porque el stock cambia con cada venta, y sin reintentos:
 * en el mostrador, un buscador que se queda pensando molesta más que uno que
 * falla rápido y se vuelve a tipear.
 */
export function Proveedores({ children }: { children: React.ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
