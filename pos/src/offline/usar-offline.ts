'use client';

/**
 * El modo sin conexión de la pantalla de venta (D56).
 *
 * Junta las tres piezas: saber si hay servidor, tener el catálogo guardado, y
 * la cola de ventas cobradas que esperan para entrar.
 *
 * El criterio de «hay conexión» es el que importa: no lo que dice
 * `navigator.onLine` —que en el local miente seguido, con el wifi andando y el
 * módem sin internet— sino si el servidor contesta. El navegador avisa rápido
 * cuando el cable se cae, y eso se aprovecha, pero la última palabra la tiene
 * el latido.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { subirVentaDiferida } from '@/app/acciones-venta';
import {
  cuantasEnCola,
  encolarVenta,
  guardarCatalogo,
  leerCatalogo,
  sacarDeLaCola,
  anotarFalla,
  ventasEnCola,
} from './almacen';
import { convieneReintentar, type VentaEnCola } from './cola';
import { estaVieja, type Instantanea } from './catalogo';

/** Cada cuánto se vuelve a preguntar si el servidor volvió. */
const LATIDO_MS = 15_000;

/** Cada cuánto se refresca el catálogo guardado mientras hay conexión. */
const REFRESCO_MS = 10 * 60_000;

export interface EstadoOffline {
  /** True si el servidor contesta. Arranca optimista para no tapar la pantalla. */
  hayConexion: boolean;
  /** El catálogo guardado, o null si todavía no se bajó ninguno. */
  catalogo: Instantanea | null;
  /** True si lo guardado tiene más horas de las que conviene (D22). */
  catalogoVieja: boolean;
  /** Cuántas ventas cobradas esperan para entrar. */
  enCola: number;
  subiendo: boolean;
  /** Lo que el dueño tiene que mirar de lo que se subió recién. */
  avisos: string[];
  /** Por qué no se puede subir, si es algo que no se arregla reintentando. */
  trabada: string | null;
  /** False si el navegador no deja guardar nada: sin esto no hay modo offline. */
  disponible: boolean;
  guardarVenta: (venta: VentaEnCola) => Promise<void>;
  subirLaCola: () => Promise<void>;
  descartarAvisos: () => void;
}

export function usarOffline(): EstadoOffline {
  const [hayConexion, setHayConexion] = useState(true);
  const [catalogo, setCatalogo] = useState<Instantanea | null>(null);
  const [enCola, setEnCola] = useState(0);
  const [subiendo, setSubiendo] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [trabada, setTrabada] = useState<string | null>(null);
  const [disponible, setDisponible] = useState(true);
  /** Evita que dos disparos —el latido y el evento del navegador— suban a la vez. */
  const subiendoAhora = useRef(false);

  const contar = useCallback(async () => {
    try {
      setEnCola(await cuantasEnCola());
    } catch {
      setDisponible(false);
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* La cola                                                                */
  /* ---------------------------------------------------------------------- */

  const subirLaCola = useCallback(async () => {
    if (subiendoAhora.current) return;
    subiendoAhora.current = true;
    setSubiendo(true);

    try {
      const pendientes = await ventasEnCola();
      const nuevos: string[] = [];
      let trabo: string | null = null;

      for (const venta of pendientes) {
        let r: Awaited<ReturnType<typeof subirVentaDiferida>>;
        try {
          r = await subirVentaDiferida({
            ...venta.datos,
            capturadaEn: venta.capturadaEn,
            cashSessionId: venta.cashSessionId,
            preciosCobradosCentavos: venta.preciosCobradosCentavos,
            totalCobradoCentavos: venta.totalCentavos,
          });
        } catch {
          // Se cayó la red en el medio: la venta se queda donde está y se
          // reintenta sola. No se marca como fallida porque no falló.
          setHayConexion(false);
          break;
        }

        if (r.ok) {
          // Recién acá se saca de la cola: mientras el servidor no haya dicho
          // que entró, la única copia que existe es esta.
          await sacarDeLaCola(venta.idempotencyKey);
          if (r.desvioCentavos !== 0) {
            nuevos.push(
              `La venta ${r.numero} se cobró a un precio distinto del que tiene el catálogo hoy.`,
            );
          }
          if (r.dejoStockEnRojo) {
            nuevos.push(`La venta ${r.numero} dejó stock en negativo: se vendió lo que no había.`);
          }
          continue;
        }

        await anotarFalla(venta.idempotencyKey, r.error);
        if (!convieneReintentar(r.error)) {
          trabo = r.error;
          break;
        }
      }

      setAvisos((previos) => [...previos, ...nuevos]);
      setTrabada(trabo);
      await contar();
    } catch {
      setDisponible(false);
    } finally {
      subiendoAhora.current = false;
      setSubiendo(false);
    }
  }, [contar]);

  const guardarVenta = useCallback(
    async (venta: VentaEnCola) => {
      // Primero guardar, siempre. Intentar subir antes de haber guardado es la
      // forma de perder una venta ya cobrada si algo sale mal en el medio.
      await encolarVenta(venta);
      await contar();
    },
    [contar],
  );

  /* ---------------------------------------------------------------------- */
  /* El catálogo                                                            */
  /* ---------------------------------------------------------------------- */

  const bajarCatalogo = useCallback(async () => {
    try {
      const r = await fetch('/api/catalogo/instantanea', { cache: 'no-store' });
      if (!r.ok) return;
      const instantanea = (await r.json()) as Instantanea;
      await guardarCatalogo(instantanea);
      setCatalogo(instantanea);
    } catch {
      // Sin conexión no se baja nada y lo guardado sigue sirviendo.
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Arranque y relojes                                                     */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const guardado = await leerCatalogo();
        if (vivo && guardado) setCatalogo(guardado);
        await contar();
      } catch {
        if (vivo) setDisponible(false);
      }
      void bajarCatalogo();
    })();

    return () => {
      vivo = false;
    };
  }, [bajarCatalogo, contar]);

  // El latido. El navegador avisa antes que nadie cuando el wifi se cae, así
  // que sus eventos disparan una comprobación en vez de decidir por sí solos.
  useEffect(() => {
    let vivo = true;

    async function latir() {
      let llega = false;
      try {
        const r = await fetch('/api/latido', { cache: 'no-store' });
        llega = r.ok;
      } catch {
        llega = false;
      }
      if (!vivo) return;

      setHayConexion((antes) => {
        // Volvió: se sube lo que haya esperando y se refresca el catálogo.
        if (llega && !antes) {
          void subirLaCola();
          void bajarCatalogo();
        }
        return llega;
      });
    }

    void latir();
    const reloj = setInterval(latir, LATIDO_MS);
    const alVolver = () => void latir();
    const alCaerse = () => setHayConexion(false);

    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alCaerse);

    return () => {
      vivo = false;
      clearInterval(reloj);
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alCaerse);
    };
  }, [bajarCatalogo, subirLaCola]);

  // Con conexión y cola llena, se insiste: puede haber quedado algo de un
  // intento anterior que falló por una razón pasajera.
  useEffect(() => {
    if (!hayConexion || enCola === 0 || trabada) return;
    const reloj = setTimeout(() => void subirLaCola(), LATIDO_MS);
    return () => clearTimeout(reloj);
  }, [hayConexion, enCola, trabada, subirLaCola]);

  // El catálogo guardado se refresca cada tanto: los precios y el stock cambian
  // con cada venta, y lo que se guardó a la mañana no sirve a la tarde.
  useEffect(() => {
    if (!hayConexion) return;
    const reloj = setInterval(() => void bajarCatalogo(), REFRESCO_MS);
    return () => clearInterval(reloj);
  }, [hayConexion, bajarCatalogo]);

  return {
    hayConexion,
    catalogo,
    catalogoVieja: catalogo !== null && estaVieja(catalogo),
    enCola,
    subiendo,
    avisos,
    trabada,
    disponible,
    guardarVenta,
    subirLaCola,
    descartarAvisos: () => setAvisos([]),
  };
}
