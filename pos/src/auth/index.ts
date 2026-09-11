/**
 * Autenticacion.
 *
 * Dos formas de entrar:
 *  - `duenio`: email + contraseña. Es el acceso del dueno.
 *  - `vendedor`: id de usuario + PIN. El vendedor se elige de una lista en
 *    pantalla y solo tipea cuatro digitos, que es lo que aguanta el mostrador.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';
import { configBase } from './config';
import { verificarPassword, verificarPin } from './pin';

const credencialesDuenio = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const credencialesVendedor = z.object({
  usuarioId: z.string().uuid(),
  pin: z.string().min(4).max(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...configBase,
  logger: {
    /**
     * Un PIN equivocado es rutina de mostrador, no un incidente: se registra en
     * una linea. Todo lo demas sale completo.
     */
    error(error) {
      // `type` y no `name`: el build de produccion minifica el nombre de clase.
      if ((error as { type?: string }).type === 'CredentialsSignin') {
        console.warn('[auth] Credencial rechazada.');
        return;
      }
      console.error('[auth]', error);
    },
    warn(codigo) {
      console.warn('[auth]', codigo);
    },
  },
  providers: [
    Credentials({
      id: 'duenio',
      name: 'Dueño',
      credentials: { email: {}, password: {} },
      async authorize(crudo) {
        const r = credencialesDuenio.safeParse(crudo);
        if (!r.success) return null;

        const [usuario] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, r.data.email), eq(users.activo, true)))
          .limit(1);

        if (!usuario || usuario.rol !== 'owner') return null;
        if (!(await verificarPassword(r.data.password, usuario.passwordHash))) return null;

        return { id: usuario.id, name: usuario.nombre, email: usuario.email, rol: usuario.rol };
      },
    }),
    Credentials({
      id: 'vendedor',
      name: 'Vendedor',
      credentials: { usuarioId: {}, pin: {} },
      async authorize(crudo) {
        const r = credencialesVendedor.safeParse(crudo);
        if (!r.success) return null;

        const [usuario] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, r.data.usuarioId), eq(users.activo, true)))
          .limit(1);

        if (!usuario) return null;
        if (!(await verificarPin(r.data.pin, usuario.pinHash))) return null;

        return { id: usuario.id, name: usuario.nombre, email: usuario.email, rol: usuario.rol };
      },
    }),
  ],
});

/** Sesion actual o error. Para usar en Server Components y Route Handlers. */
export async function exigirSesion() {
  const sesion = await auth();
  if (!sesion?.user) throw new Error('No hay sesion iniciada.');
  return sesion.user;
}
