/**
 * Configuracion base de Auth.js, sin nada que dependa de Node.
 *
 * El middleware corre en el runtime edge y no puede cargar bcrypt ni el driver
 * de PostgreSQL, asi que la parte que si los necesita vive en `./index.ts`.
 */
import type { NextAuthConfig } from 'next-auth';
import type { Rol } from './permisos';

/**
 * Rutas que no piden sesion de usuario.
 *
 * Las de API se autentican por su cuenta: `/api/webhooks` con la firma HMAC de
 * WooCommerce y `/api/cron` con `CRON_SECRET`. Ninguna queda abierta de verdad.
 *
 * Las tres ultimas son las piezas de la aplicacion instalable (D56), y estan
 * aca porque el navegador las pide **sin la cookie de sesion**:
 *
 *  - `/manifest.webmanifest` se baja sin credenciales salvo que se le ponga
 *    `crossorigin="use-credentials"`, asi que detras del portero devolvia un
 *    redirect a `/ingresar` y el POS no se podia instalar en la tablet.
 *  - `/sw.js` si viaja con cookie, pero servir un service worker detras de
 *    sesion es fragil: el dia que devuelva el HTML del login, el navegador
 *    rechaza el registro por el tipo de contenido y el modo sin conexion
 *    desaparece sin que nadie se entere.
 *  - `/api/latido` responde 204 vacio y solo dice que el servidor esta vivo.
 *    Con sesion, un token vencido se leia como «volvio internet» y la pantalla
 *    quedaba en el modo equivocado.
 *
 * Ninguna de las tres devuelve un dato del negocio.
 */
export const RUTAS_PUBLICAS = [
  '/ingresar',
  '/api/auth',
  '/api/webhooks',
  '/api/cron',
  '/api/latido',
  '/manifest.webmanifest',
  '/sw.js',
];

export const configBase = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/ingresar', error: '/ingresar' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.rol = (user as { rol?: Rol }).rol ?? 'seller';
        token.nombre = (user as { name?: string }).name ?? '';
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub ?? '');
        session.user.rol = (token.rol as Rol) ?? 'seller';
        session.user.name = (token.nombre as string) ?? session.user.name;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (RUTAS_PUBLICAS.some((r) => pathname.startsWith(r))) return true;
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
