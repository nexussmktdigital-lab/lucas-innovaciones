import { describe, expect, it } from 'vitest';
import { firmar, firmaValida } from './webhook';

const SECRETO = 'secreto-compartido-de-prueba';
const CUERPO = JSON.stringify({ id: 7001, name: 'iPhone 14 Pro', stock_quantity: 3 });

describe('firma de webhook', () => {
  it('acepta la firma correcta', () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, SECRETO), SECRETO)).toBe(true);
  });

  it('rechaza una firma de otro secreto', () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, 'otro'), SECRETO)).toBe(false);
  });

  it('rechaza si cambia un solo byte del cuerpo', () => {
    const firma = firmar(CUERPO, SECRETO);
    const alterado = CUERPO.replace('"stock_quantity":3', '"stock_quantity":300');
    expect(firmaValida(alterado, firma, SECRETO)).toBe(false);
  });

  it('rechaza sin firma o sin secreto', () => {
    expect(firmaValida(CUERPO, null, SECRETO)).toBe(false);
    expect(firmaValida(CUERPO, firmar(CUERPO, SECRETO), '')).toBe(false);
  });

  it('rechaza una firma de largo distinto sin reventar', () => {
    expect(firmaValida(CUERPO, 'abc', SECRETO)).toBe(false);
  });
});
