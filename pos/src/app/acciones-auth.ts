'use server';

/**
 * Acciones de ingreso. Viven en el servidor: la credencial nunca pasa por el
 * cliente mas que en el envio del formulario.
 *
 * Se usa `redirect: false` a proposito. Con la redireccion automatica de
 * Auth.js, un PIN equivocado termina en `/ingresar?error=...` y el cajero no ve
 * el motivo al lado del campo. Asi el error vuelve al formulario y la
 * redireccion de exito la hacemos nosotros.
 */
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/auth';

export interface EstadoIngreso {
  error?: string;
}

async function intentar(
  proveedor: 'duenio' | 'vendedor',
  credenciales: Record<string, string>,
  mensajeDeError: string,
): Promise<EstadoIngreso> {
  try {
    await signIn(proveedor, { ...credenciales, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: mensajeDeError };
    throw error;
  }
  // Fuera del try: `redirect` funciona lanzando una excepcion propia de Next,
  // y no queremos que el catch de arriba se la coma.
  redirect('/');
}

export async function ingresarComoDuenio(
  _estado: EstadoIngreso,
  datos: FormData,
): Promise<EstadoIngreso> {
  return intentar(
    'duenio',
    {
      email: String(datos.get('email') ?? ''),
      password: String(datos.get('password') ?? ''),
    },
    'Email o contraseña incorrectos.',
  );
}

export async function ingresarConPin(
  _estado: EstadoIngreso,
  datos: FormData,
): Promise<EstadoIngreso> {
  return intentar(
    'vendedor',
    {
      usuarioId: String(datos.get('usuarioId') ?? ''),
      pin: String(datos.get('pin') ?? ''),
    },
    'PIN incorrecto.',
  );
}

export async function salir() {
  await signOut({ redirect: false });
  redirect('/ingresar');
}
