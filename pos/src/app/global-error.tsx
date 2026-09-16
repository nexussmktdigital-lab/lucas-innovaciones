'use client';

/**
 * La red de contención de más afuera.
 *
 * Se usa cuando falla el layout raíz, que es el único caso que `error.tsx` no
 * puede atrapar. Reemplaza al documento entero —por eso lleva `<html>` y
 * `<body>` propios— y por eso mismo no puede usar la hoja de estilos del
 * proyecto: si lo que falló fue el layout, tampoco cargó el CSS. Va con estilos
 * en línea, que es feo y es lo único que funciona siempre.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es-AR">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          color: '#111',
          background: '#f8fafc',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.75rem' }}>El POS no pudo arrancar</h1>
          <p style={{ fontWeight: 600, color: '#15803d', margin: '0 0 0.75rem' }}>
            No se cobró nada y no se perdió ninguna venta.
          </p>
          <p style={{ color: '#555', margin: '0 0 1.5rem' }}>
            Probá recargar. Si sigue igual, avisale a quien mantiene el sistema.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '3rem',
              padding: '0 1.5rem',
              borderRadius: '0.5rem',
              border: 0,
              background: '#1f2937',
              color: '#fff',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            Recargar
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#777' }}>
              Código para quien lo arregla: <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
