'use client';

/**
 * Registra el service worker que hace que el POS abra sin internet (D56).
 *
 * Va acá dentro y no en el layout raíz a propósito: lo que tiene que abrir sin
 * conexión es el POS con sesión iniciada, no la pantalla de ingreso, que sin
 * servidor no puede hacer nada de todos modos.
 *
 * En desarrollo no se registra. Un service worker que sirve páginas guardadas
 * mientras se está editando código es la forma más rápida de pasar una tarde
 * mirando una versión vieja de lo que uno acaba de cambiar.
 */
import { useEffect } from 'react';

export default function RegistroSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const alCargar = () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        // Sin service worker el POS anda igual: lo único que se pierde es poder
        // recargar la pantalla sin internet. No es motivo para romper nada.
        console.warn('[sw] No se pudo registrar:', e);
      });
    };

    if (document.readyState === 'complete') alCargar();
    else window.addEventListener('load', alCargar);

    return () => window.removeEventListener('load', alCargar);
  }, []);

  return null;
}
