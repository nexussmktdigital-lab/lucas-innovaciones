import type { Rol } from './permisos';

declare module 'next-auth' {
  interface User {
    rol?: Rol;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      rol: Rol;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    rol?: Rol;
    nombre?: string;
  }
}

export {};
