import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'POS · Lucas Innovaciones',
  description: 'Punto de venta de Lucas Innovaciones',
  // Instalable en la tablet del mostrador: abre a pantalla completa y sin barra
  // de navegador, que es lo que evita que alguien toque «atrás» en el medio de
  // un cobro.
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icono.svg', apple: '/icono.svg' },
  appleWebApp: { capable: true, title: 'POS', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1f2937',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
