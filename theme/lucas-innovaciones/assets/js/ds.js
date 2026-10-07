/**
 * Lucas Innovaciones — comportamiento de las piezas del design system.
 * Cajón de categorías y contador del carrito. Sin dependencias.
 */
(function () {
	'use strict';

	var drawer = document.getElementById('li-drawer');
	var abridores = document.querySelectorAll('[data-li-drawer-open]');
	var ultimoFoco = null;

	function abrir(e) {
		if (!drawer) return;
		ultimoFoco = e && e.currentTarget;
		drawer.hidden = false;
		document.body.classList.add('li-drawer-abierto');
		abridores.forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
		var cerrar = drawer.querySelector('[data-li-drawer-close].li-iconbtn');
		if (cerrar) cerrar.focus();
	}

	function cerrar() {
		if (!drawer || drawer.hidden) return;
		drawer.hidden = true;
		document.body.classList.remove('li-drawer-abierto');
		abridores.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
		if (ultimoFoco) ultimoFoco.focus();
	}

	abridores.forEach(function (b) { b.addEventListener('click', abrir); });
	if (drawer) {
		drawer.querySelectorAll('[data-li-drawer-close]').forEach(function (b) { b.addEventListener('click', cerrar); });
	}
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') cerrar();
	});

	/*
	 * Contador del carrito. WooCommerce avisa por eventos de jQuery
	 * (added_to_cart, wc_fragments_refreshed), no por eventos del DOM: por eso
	 * el contador del tema anterior nunca cambiaba. Se escucha por jQuery si
	 * está, y se pide la cuenta real a la Store API.
	 */
	function actualizarCuenta() {
		if (!window.fetch) return;
		fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })
			.then(function (r) { return r.ok ? r.json() : null; })
			.then(function (c) {
				if (!c) return;
				var n = c.items_count || 0;
				document.querySelectorAll('[data-li-cart-count]').forEach(function (el) {
					el.textContent = n;
					el.hidden = n < 1;
				});
			})
			.catch(function () {});
	}

	if (window.jQuery) {
		window.jQuery(document.body).on('added_to_cart removed_from_cart wc_fragments_refreshed', actualizarCuenta);
	}
	document.body.addEventListener('wc-blocks_added_to_cart', actualizarCuenta);

	/* Panel de filtros del catálogo (móvil). En desktop es la barra lateral. */
	function filtros(abrir) {
		document.body.classList.toggle('li-filtros-abiertos', abrir);
		document.querySelectorAll('[data-li-filtros-abrir]').forEach(function (b) {
			b.setAttribute('aria-expanded', abrir ? 'true' : 'false');
		});
	}
	document.addEventListener('click', function (e) {
		if (!e.target.closest) return;
		if (e.target.closest('[data-li-filtros-abrir]')) filtros(true);
		else if (e.target.closest('[data-li-filtros-cerrar]')) filtros(false);
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') filtros(false);
	});

	/* Ficha: galería. */
	var principal = document.querySelector('[data-li-galeria-principal]');
	document.querySelectorAll('[data-li-galeria]').forEach(function (b) {
		b.addEventListener('click', function () {
			if (!principal) return;
			principal.removeAttribute('srcset');
			principal.src = b.getAttribute('data-li-galeria');
			document.querySelectorAll('[data-li-galeria]').forEach(function (x) { x.classList.toggle('es-activa', x === b); });
		});
	});

	/* Ficha: cantidad con − y + alrededor del campo de WooCommerce. */
	document.querySelectorAll('.li-pdp .quantity').forEach(function (q) {
		var input = q.querySelector('input.qty');
		if (!input || input.type === 'hidden' || q.querySelector('.li-qty__btn')) return;
		function paso(d) {
			var min = parseFloat(input.min) || 1;
			var max = parseFloat(input.max) || Infinity;
			var v = Math.min(max, Math.max(min, (parseFloat(input.value) || min) + d));
			input.value = v;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
		var menos = document.createElement('button');
		var mas = document.createElement('button');
		menos.type = mas.type = 'button';
		menos.className = mas.className = 'li-qty__btn';
		menos.setAttribute('aria-label', 'Restar uno');
		mas.setAttribute('aria-label', 'Sumar uno');
		menos.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/></svg>';
		mas.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
		menos.addEventListener('click', function () { paso(-1); });
		mas.addEventListener('click', function () { paso(1); });
		q.insertBefore(menos, input);
		q.appendChild(mas);
		q.classList.add('li-qty');
	});

	/* Ficha: la barra fija de compra en móvil usa el botón real del formulario. */
	document.addEventListener('click', function (e) {
		if (!e.target.closest || !e.target.closest('[data-li-comprar]')) return;
		var real = document.querySelector('.li-pdp form.cart .single_add_to_cart_button');
		if (real) real.click();
	});
	var caja = document.querySelector('.li-pdp__buy');
	var barra = document.querySelector('.li-buybar');
	if (caja && barra && 'IntersectionObserver' in window) {
		new IntersectionObserver(function (es) {
			barra.classList.toggle('es-visible', !es[0].isIntersecting && es[0].boundingClientRect.top < 0);
		}).observe(caja);
	}

	/* Ficha: en la fila de "otras unidades" (móvil) se ve la unidad actual. */
	document.querySelectorAll('.li-units__list').forEach(function (l) {
		var actual = l.querySelector('.es-actual');
		if (actual && l.scrollWidth > l.clientWidth) {
			l.scrollLeft += actual.getBoundingClientRect().left - l.getBoundingClientRect().left - 16;
		}
	});

	/*
	 * Checkout: errores fantasma del formulario de envío.
	 *
	 * Con «Retiro en local» el formulario de envío no se muestra, pero al cargar
	 * la página llega a armarse un instante, marca la provincia vacía y se
	 * desarma: el error queda registrado y «Realizar el pedido» no hace nada,
	 * sin ningún mensaje. Mientras se retira en el local y ese formulario no
	 * está a la vista, sus errores no corresponden y se limpian.
	 */
	window.addEventListener('load', function () {
		if (!window.wp || !window.wp.data || !document.querySelector('.wp-block-woocommerce-checkout')) return;
		var limpiarEnvio = function () {
			try {
				var checkout = window.wp.data.select('wc/store/checkout');
				var validacion = window.wp.data.select('wc/store/validation');
				if (!checkout || !validacion || !checkout.prefersCollection || !checkout.prefersCollection()) return;
				if (document.querySelector('#shipping-address_1, #shipping-state')) return;
				var claves = Object.keys(validacion.getValidationErrors() || {}).filter(function (k) {
					return k.indexOf('shipping_') === 0;
				});
				if (claves.length) window.wp.data.dispatch('wc/store/validation').clearValidationErrors(claves);
			} catch (e) {
				// Si cambia la API de WooCommerce, el checkout sigue como venía.
			}
		};
		window.wp.data.subscribe(limpiarEnvio);
		limpiarEnvio(); // El error pudo quedar registrado antes de este momento.
	});

	/* Fila de categorías de la cabecera: flechas solo si no entra. */
	var fila = document.querySelector('[data-li-catnav]');
	if (fila) {
		var prev = document.querySelector('[data-li-catnav-prev]');
		var next = document.querySelector('[data-li-catnav-next]');
		var revisar = function () {
			var max = fila.scrollWidth - fila.clientWidth;
			prev.hidden = fila.scrollLeft <= 2;
			next.hidden = fila.scrollLeft >= max - 2;
		};
		prev.addEventListener('click', function () { fila.scrollBy({ left: -280 }); });
		next.addEventListener('click', function () { fila.scrollBy({ left: 280 }); });
		fila.addEventListener('scroll', revisar, { passive: true });
		window.addEventListener('resize', revisar);
		revisar();
	}
})();
