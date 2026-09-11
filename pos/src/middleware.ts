/**
 * Portero de rutas. Corre en el runtime edge, asi que usa solo la config base.
 */
import NextAuth from 'next-auth';
import { configBase } from '@/auth/config';

export const { auth: middleware } = NextAuth(configBase);
export default middleware;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
