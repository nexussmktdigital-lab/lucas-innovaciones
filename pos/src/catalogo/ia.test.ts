/**
 * Tests de la ayuda para armar la ficha.
 *
 * No se llama a la API: lo que hay que probar es que el catálogo mande sobre lo
 * sugerido, y que sin credencial el alta siga funcionando. Una sugerencia que
 * inventa una categoría es peor que no tener sugerencia.
 */
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acotarAlCatalogo,
  ErrorIA,
  hayIA,
  MODELO_POR_DEFECTO,
  sugerirFicha,
  type FichaSugerida,
} from './ia';

const CATEGORIAS = ['Cables de carga', 'Fundas', 'Servicio técnico'];
const MARCAS = ['FoxBox', 'Apple', 'Hiksemi'];

function ficha(parcial: Partial<FichaSugerida> = {}): FichaSugerida {
  return {
    nombre: 'Cable USB tipo C FoxBox Axon 20W',
    marca: 'FoxBox',
    categoria: 'Cables de carga',
    esServicio: false,
    confianza: 'alta',
    ...parcial,
  };
}

const CLAVE = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (CLAVE === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = CLAVE;
});

describe('sin credencial', () => {
  it('el alta sigue andando: no hay sugerencia y no es un error', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(hayIA({ NODE_ENV: 'test' })).toBe(false);

    const r = await sugerirFicha('cable tipo c', { categorias: CATEGORIAS, marcas: MARCAS });
    expect(r).toBeNull();
  });
});

describe('lo que ni siquiera se manda', () => {
  it('un texto vacío', async () => {
    await expect(
      sugerirFicha('   ', { categorias: CATEGORIAS, marcas: MARCAS }),
    ).rejects.toThrow(ErrorIA);
  });

  it('un texto larguísimo, que no es la descripción de un producto', async () => {
    await expect(
      sugerirFicha('x'.repeat(501), { categorias: CATEGORIAS, marcas: MARCAS }),
    ).rejects.toThrow(/demasiado largo/);
  });
});

describe('el catálogo manda sobre lo sugerido', () => {
  it('una categoría que existe se acepta', () => {
    const r = acotarAlCatalogo(ficha(), { categorias: CATEGORIAS, marcas: MARCAS });
    expect(r.categoria).toBe('Cables de carga');
  });

  /*
   * Lo que esta fase vino a ordenar es justamente el catálogo. Aceptar una
   * categoría inventada sería agregarle desorden con más comodidad.
   */
  it('una categoría inventada se descarta', () => {
    const r = acotarAlCatalogo(ficha({ categoria: 'Cablecitos varios' }), {
      categorias: CATEGORIAS,
      marcas: MARCAS,
    });
    expect(r.categoria).toBeNull();
  });

  it('una categoría escrita con otro acento se resuelve a la del catálogo', () => {
    const r = acotarAlCatalogo(ficha({ categoria: 'SERVICIO TECNICO' }), {
      categorias: CATEGORIAS,
      marcas: MARCAS,
    });
    expect(r.categoria).toBe('Servicio técnico');
  });

  /* Sin esto el catálogo termina con «Fox Box», «FoxBox» y «fox box». */
  it('una marca escrita distinto se unifica con la del catálogo', () => {
    const r = acotarAlCatalogo(ficha({ marca: 'fox box' }), {
      categorias: CATEGORIAS,
      marcas: ['FoxBox', 'Fox Box'],
    });
    expect(r.marca).toBe('Fox Box');
  });

  it('una marca nueva se deja pasar: el catálogo tiene que poder crecer', () => {
    const r = acotarAlCatalogo(ficha({ marca: 'Baseus' }), {
      categorias: CATEGORIAS,
      marcas: MARCAS,
    });
    expect(r.marca).toBe('Baseus');
  });

  it('sin marca queda sin marca', () => {
    const r = acotarAlCatalogo(ficha({ marca: null }), {
      categorias: CATEGORIAS,
      marcas: MARCAS,
    });
    expect(r.marca).toBeNull();
  });

  it('el nombre se normaliza en espacios', () => {
    const r = acotarAlCatalogo(ficha({ nombre: '  Cable   tipo C  ' }), {
      categorias: CATEGORIAS,
      marcas: MARCAS,
    });
    expect(r.nombre).toBe('Cable tipo C');
  });
});

/**
 * Un cliente que no sale a la red: guarda lo que se le iba a mandar y contesta
 * lo que se le indique. Alcanza para comprobar la forma del pedido, que es lo
 * único que no se puede verificar sin credencial.
 */
function clienteDeMentira(respuesta: unknown) {
  const pedidos: Record<string, unknown>[] = [];

  const cliente = new Anthropic({
    apiKey: 'sk-ant-de-prueba',
    maxRetries: 0,
    fetch: (async (_url: unknown, init: { body: string }) => {
      pedidos.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: MODELO_POR_DEFECTO,
          content: [{ type: 'text', text: JSON.stringify(respuesta) }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
  });

  return { cliente, pedidos };
}

describe('la forma del pedido', () => {
  it('manda el catálogo, pide poco esfuerzo y exige la ficha estructurada', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba';
    const { cliente, pedidos } = clienteDeMentira(ficha());

    const r = await sugerirFicha('cable tipo c fox box axon 20w', {
      categorias: CATEGORIAS,
      marcas: MARCAS,
      cliente,
    });

    expect(r?.nombre).toBe('Cable USB tipo C FoxBox Axon 20W');

    const pedido = pedidos[0]!;
    expect(pedido.model).toBe(MODELO_POR_DEFECTO);

    // Es una tarea corta: no tiene sentido gastar razonamiento con el mostrador
    // esperando.
    const salida = pedido.output_config as { effort: string; format: { type: string } };
    expect(salida.effort).toBe('low');
    expect(salida.format.type).toBe('json_schema');

    // Las categorías del catálogo tienen que ir en el pedido: sin eso la
    // sugerencia no tiene de dónde elegir y las inventa.
    const texto = JSON.stringify(pedido.messages);
    expect(texto).toContain('Cables de carga');
    expect(texto).toContain('FoxBox');
    expect(texto).toContain('cable tipo c fox box axon 20w');
  });

  it('lo que vuelve también pasa por el filtro del catálogo', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba';
    const { cliente } = clienteDeMentira(ficha({ categoria: 'Cablecitos inventados' }));

    const r = await sugerirFicha('cable', {
      categorias: CATEGORIAS,
      marcas: MARCAS,
      cliente,
    });

    expect(r?.categoria).toBeNull();
  });
});

describe('lo que la sugerencia no trae, por diseño', () => {
  /*
   * Un precio inventado se cobra, y una foto inventada de un SKU real produce
   * reclamos y contracargos (D15). El tipo de la ficha no tiene esos campos, y
   * esto lo deja escrito para que no se agreguen por comodidad más adelante.
   */
  it('la ficha sugerida no tiene precio, ni stock, ni imagen', () => {
    const campos = Object.keys(ficha());
    expect(campos).not.toContain('precioCentavos');
    expect(campos).not.toContain('precio');
    expect(campos).not.toContain('stock');
    expect(campos).not.toContain('imagenUrl');
    expect(campos.sort()).toEqual(['categoria', 'confianza', 'esServicio', 'marca', 'nombre']);
  });
});
