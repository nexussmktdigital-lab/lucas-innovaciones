import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

/*
 * Las dos tipografías de la marca.
 *
 * Inter para todo lo que se lee —interfaz, listas, formularios— y Space Grotesk
 * para los títulos y las cifras de plata, que son lo que se mira de lejos.
 *
 * Van con `next/font`: las descarga en la construcción y las sirve desde el
 * mismo dominio. Eso importa más de lo que parece acá: la tablet del mostrador
 * trabaja sin conexión, y una fuente pedida a Google no llegaría nunca.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--fuente-ui',
  display: 'swap',
});

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--fuente-titulo',
  display: 'swap',
});

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
  // El mismo negro de la barra: en la tablet, el borde del sistema se funde
  // con la aplicación en vez de dibujar una franja gris arriba.
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
