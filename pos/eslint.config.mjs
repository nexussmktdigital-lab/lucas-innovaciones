/**
 * Reglas de lint.
 *
 * `next lint` quedó deprecado y el script de `package.json` abría un asistente
 * interactivo: en una terminal se ve raro, en integración continua se cuelga
 * esperando una tecla para siempre. Era el hallazgo 16 de la auditoría.
 *
 * El conjunto es el de Next con TypeScript, y nada más: lo que de verdad frena
 * los errores en este proyecto es `tsc` en modo estricto con
 * `noUncheckedIndexedAccess`, que ya corre en cada build. Esto agrega lo que el
 * compilador no ve —hooks mal usados, `<img>` en vez de `<Image>`, enlaces que
 * recargan la página entera— y por eso no hace falta apretarlo más.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    // `next-env.d.ts` lo genera Next en cada build y lo reescribe siempre igual;
    // los archivos de configuración exportan un objeto suelto porque es el
    // formato que piden sus herramientas.
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      '.demo/**',
      'test-results/**',
      'next-env.d.ts',
      '*.config.mjs',
      '*.config.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // El proyecto usa `!` a propósito donde ya comprobó que hay valor, que
      // con `noUncheckedIndexedAccess` es todo el tiempo.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
