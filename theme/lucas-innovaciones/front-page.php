<?php
/**
 * Portada.
 *
 * Diseñada para el catálogo real: 797 productos, 77 categorías, 93 marcas
 * y apenas 22 fotos. Una portada apoyada en imágenes sería una promesa que
 * el catálogo no puede sostener, así que se apoya en lo que sí hay de sobra:
 * amplitud, datos de venta reales y un local con dirección y horario.
 *
 * Cuando entren las fotos, se agrega el bloque visual sin tocar el resto.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header();

$li_datos  = li_datos_portada();
$li_local  = li_local();
?>

<main id="contenido" class="contenido contenido--portada">

	<!-- ---------------------------------------------------------------
		 Encabezado
		 --------------------------------------------------------------- -->
	<section class="hero">
		<div class="contenedor">
			<div class="hero__grilla">

				<div class="hero__texto">
					<p class="hero__ubicacion">
						<?php li_icono( 'filtro' ); ?>
						<?php echo esc_html( $li_local['ciudad'] ? $li_local['ciudad'] : 'Córdoba' ); ?>
					</p>

					<h1 class="hero__titulo">
						Tecnología<br>
						<span class="hero__titulo-acento">a la vuelta</span>
					</h1>

					<p class="hero__bajada">
						Del cable que necesitás hoy al teléfono que venís buscando.
						<?php if ( $li_local['direccion'] ) : ?>
							Retiralo en <strong><?php echo esc_html( $li_local['direccion'] ); ?></strong> o te lo enviamos.
						<?php endif; ?>
					</p>

					<form role="search" method="get" class="hero__buscador" action="<?php echo esc_url( home_url( '/' ) ); ?>">
						<label class="visually-hidden" for="li-hero-buscar">Buscar productos</label>
						<input type="search" id="li-hero-buscar" name="s" class="hero__campo"
							placeholder="Buscar cable, funda, cargador, celular…" autocomplete="off">
						<input type="hidden" name="post_type" value="product">
						<button type="submit" class="boton hero__enviar">Buscar</button>
					</form>

					<p class="hero__atajos">
						<span>Buscado seguido:</span>
						<?php foreach ( $li_datos['atajos'] as $a ) : ?>
							<a href="<?php echo esc_url( $a['url'] ); ?>"><?php echo esc_html( $a['nombre'] ); ?></a>
						<?php endforeach; ?>
					</p>
				</div>

				<!-- La escala del catálogo como elemento gráfico: es lo que
					 realmente distingue al negocio y no necesita fotos. -->
				<aside class="hero__cifras" aria-label="El catálogo en números">
					<div class="cifra">
						<span class="cifra__num"><?php echo esc_html( number_format( $li_datos['productos'], 0, ',', '.' ) ); ?></span>
						<span class="cifra__etq">productos</span>
					</div>
					<div class="cifra">
						<span class="cifra__num"><?php echo esc_html( (string) $li_datos['categorias'] ); ?></span>
						<span class="cifra__etq">categorías</span>
					</div>
					<div class="cifra">
						<span class="cifra__num"><?php echo esc_html( (string) $li_datos['marcas'] ); ?></span>
						<span class="cifra__etq">marcas</span>
					</div>
				</aside>

			</div>
		</div>
	</section>

	<!-- ---------------------------------------------------------------
		 Destacados
		 --------------------------------------------------------------- -->
	<?php li_banners_render(); ?>

	<!-- ---------------------------------------------------------------
		 Retiro en el local — la propuesta más fuerte del negocio
		 --------------------------------------------------------------- -->
	<?php if ( $li_local['direccion'] ) : ?>
	<section class="local">
		<div class="contenedor">
			<div class="local__caja">
				<div class="local__bloque">
					<p class="local__etq">Retiro en el local</p>
					<p class="local__dato"><?php echo esc_html( $li_local['direccion'] ); ?></p>
					<?php if ( $li_local['ciudad'] ) : ?>
						<p class="local__sub"><?php echo esc_html( $li_local['ciudad'] ); ?><?php echo $li_local['cp'] ? ' · CP ' . esc_html( $li_local['cp'] ) : ''; ?></p>
					<?php endif; ?>
				</div>

				<?php if ( $li_local['horario'] ) : ?>
				<div class="local__bloque">
					<p class="local__etq">Horario</p>
					<p class="local__dato local__dato--mono"><?php echo esc_html( $li_local['horario'] ); ?></p>
				</div>
				<?php endif; ?>

				<div class="local__bloque">
					<p class="local__etq">Cómo pagás</p>
					<p class="local__sub">Mercado Pago, tarjeta o transferencia</p>
				</div>
			</div>
		</div>
	</section>
	<?php endif; ?>

	<!-- ---------------------------------------------------------------
		 Categorías
		 --------------------------------------------------------------- -->
	<?php if ( $li_datos['categorias_top'] ) : ?>
	<section class="seccion-portada">
		<div class="contenedor">
			<div class="seccion__cabecera">
				<h2 class="seccion__titulo">Categorías</h2>
				<a class="seccion__enlace" href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>">Ver todo el catálogo</a>
			</div>

			<ul class="categorias">
				<?php foreach ( $li_datos['categorias_top'] as $c ) : ?>
					<li class="categoria">
						<a class="categoria__enlace" href="<?php echo esc_url( $c['url'] ); ?>">
							<?php li_medallon_categoria( $c ); ?>
							<span class="categoria__nombre"><?php echo esc_html( $c['nombre'] ); ?></span>
							<span class="categoria__cuenta"><?php echo esc_html( (string) $c['cuenta'] ); ?></span>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		</div>
	</section>
	<?php endif; ?>

	<!-- ---------------------------------------------------------------
		 Lo que más se vende — datos reales de 12 meses
		 --------------------------------------------------------------- -->
	<?php if ( $li_datos['mas_vendidos'] ) : ?>
	<section class="seccion-portada seccion-portada--alt">
		<div class="contenedor">
			<div class="seccion__cabecera">
				<h2 class="seccion__titulo">Lo que más se vende</h2>
				<span class="seccion__enlace">últimos 12 meses</span>
			</div>

			<?php li_grilla_productos( $li_datos['mas_vendidos'] ); ?>
		</div>
	</section>
	<?php endif; ?>

	<!-- ---------------------------------------------------------------
		 Marcas
		 --------------------------------------------------------------- -->
	<?php if ( $li_datos['marcas_top'] ) : ?>
	<section class="seccion-portada">
		<div class="contenedor">
			<div class="seccion__cabecera">
				<h2 class="seccion__titulo">Marcas</h2>
				<span class="seccion__enlace"><?php echo esc_html( (string) $li_datos['marcas'] ); ?> en total</span>
			</div>

			<ul class="marcas">
				<?php foreach ( $li_datos['marcas_top'] as $m ) : ?>
					<li>
						<a class="marca-item" href="<?php echo esc_url( $m['url'] ); ?>">
							<?php li_medallon_marca( $m ); ?>
							<span class="marca-item__nombre"><?php echo esc_html( $m['nombre'] ); ?></span>
							<span class="marca-item__cuenta"><?php echo esc_html( (string) $m['cuenta'] ); ?></span>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		</div>
	</section>
	<?php endif; ?>

	<!-- ---------------------------------------------------------------
		 Últimos ingresos
		 --------------------------------------------------------------- -->
	<?php if ( $li_datos['ultimos'] ) : ?>
	<section class="seccion-portada seccion-portada--alt">
		<div class="contenedor">
			<div class="seccion__cabecera">
				<h2 class="seccion__titulo">Últimos ingresos</h2>
				<a class="seccion__enlace" href="<?php echo esc_url( add_query_arg( 'orderby', 'date', wc_get_page_permalink( 'shop' ) ) ); ?>">Ver más</a>
			</div>

			<?php li_grilla_productos( $li_datos['ultimos'] ); ?>
		</div>
	</section>
	<?php endif; ?>

</main>

<?php
get_footer();
