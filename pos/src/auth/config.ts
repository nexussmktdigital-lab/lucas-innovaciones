/**
 * Configuracion base de Auth.js, sin nada que dependa de Node.
 *
 * El middleware corre en el runtime edge y no puede cargar bcrypt ni el driver
 * de PostgreSQL, asi que la parte que si los necesita vive en `./index.ts`.
 */
import type { NextAuthConfig } from 'next-auth';
import type { Rol } from './permisos';

export const RUTAS_PUBLICAS = ['/ingresar', '/api/auth', '/api/webhooks'];

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
