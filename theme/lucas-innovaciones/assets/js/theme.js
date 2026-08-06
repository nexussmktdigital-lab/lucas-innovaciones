/**
 * Lucas Innovaciones — interacciones del tema.
 * Sin dependencias. Todo degrada a HTML funcional si el JS no carga.
 */
(function () {
  "use strict";

  /* Menú en móvil ------------------------------------------------------ */

  var boton = document.querySelector("[data-li-menu]");
  var nav = document.getElementById("li-nav");

  if (boton && nav) {
    boton.addEventListener("click", function () {
      var abierto = boton.getAttribute("aria-expanded") === "true";
      boton.setAttribute("aria-expanded", String(!abierto));
      nav.style.display = abierto ? "" : "block";
    });
  }

  /* Contador del carrito ----------------------------------------------- */

  document.body.addEventListener("added_to_cart", function (e) {
    var nodo = document.querySelector("[data-li-cart-count]");
    if (!nodo) return;

    var frag = e && e.detail ? e.detail : null;
    var n = parseInt(nodo.textContent, 10) || 0;
    nodo.textContent = String(n + 1);

    var cont = nodo.closest(".acciones__item--carrito");
    if (cont) cont.classList.add("tiene-items");
  });

  /* Cantidad: evita que el campo quede vacío al borrar ------------------ */

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.matches || !t.matches(".quantity input[type='number']")) return;
    if (t.value === "" || parseInt(t.value, 10) < 1) t.value = "1";
  });

  /* Mega menú ------------------------------------------------------------
     Abre y cierra con :hover y :focus-within desde el CSS. Acá sólo se
     agrega el clic, que es lo único que no se puede resolver sin JS en
     una pantalla táctil. */

  var mega = document.querySelector("[data-li-mega]");

  if (mega) {
    var disparador = mega.querySelector("[data-li-mega-abrir]");

    var cerrarMega = function () {
      mega.classList.remove("esta-abierto");
      disparador.setAttribute("aria-expanded", "false");
    };

    disparador.addEventListener("click", function () {
      var abierto = mega.classList.toggle("esta-abierto");
      disparador.setAttribute("aria-expanded", String(abierto));
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      cerrarMega();
      if (mega.contains(document.activeElement)) disparador.focus();
    });

    // Un clic afuera cierra. El del propio disparador no llega acá como
    // "afuera" porque el menú lo contiene.
    document.addEventListener("click", function (e) {
      if (!mega.contains(e.target)) cerrarMega();
    });
  }

  /* Filtros del catálogo -------------------------------------------------
     Los filtros son enlaces normales: sin JS recargan y funcionan igual.
     Acá se intercepta el clic, se pide sólo el fragmento que cambia
     (`li_frag=1`) y se reescribe la URL, para que un link filtrado se
     pueda copiar y compartir. */

  var resultados = document.querySelector("[data-li-resultados]");

  if (resultados && window.fetch && window.AbortController) {
    var pedido = null;

    var reemplazar = function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");

      var nuevos = doc.querySelector("[data-li-resultados]");
      if (nuevos) resultados.innerHTML = nuevos.innerHTML;

      // El carrusel también cambia: se marca la activa y se recalculan
      // los enlaces de cada marca.
      var carrusel = document.querySelector("[data-li-carrusel]");
      var nuevoCarrusel = doc.querySelector("[data-li-carrusel]");
      if (carrusel && nuevoCarrusel) carrusel.innerHTML = nuevoCarrusel.innerHTML;

      // Las facetas cambian con cada filtro: aparecen y desaparecen
      // opciones, y las cuentas ya no son las mismas.
      var facetas = document.querySelector("[data-li-facetas]");
      var nuevasFacetas = doc.querySelector("[data-li-facetas]");
      if (facetas && nuevasFacetas) facetas.innerHTML = nuevasFacetas.innerHTML;
    };

    var ir = function (url, apilar) {
      if (pedido) pedido.abort();
      pedido = new AbortController();

      resultados.classList.add("esta-cargando");
      resultados.setAttribute("aria-busy", "true");

      var sep = url.indexOf("?") === -1 ? "?" : "&";

      fetch(url + sep + "li_frag=1", { signal: pedido.signal })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.text();
        })
        .then(function (html) {
          reemplazar(html);
          if (apilar) history.pushState({ li: 1 }, "", url);

          var caja = document.querySelector(".catalogo");
          if (caja && caja.getBoundingClientRect().top < 0) {
            caja.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        })
        .catch(function (e) {
          // Si algo falla se navega de verdad: nunca queda sin responder.
          if (e.name !== "AbortError") window.location.href = url;
        })
        .then(function () {
          pedido = null;
          resultados.classList.remove("esta-cargando");
          resultados.removeAttribute("aria-busy");
        });
    };

    document.addEventListener("click", function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!e.target.closest) return;

      var a = e.target.closest("[data-li-filtro], .woocommerce-pagination a");
      if (!a || !a.href) return;

      e.preventDefault();
      ir(a.href, true);
    });

    document.addEventListener("change", function (e) {
      if (!e.target.matches || !e.target.matches("[data-li-orden]")) return;

      var u = new URL(window.location.href);
      u.searchParams.set("orderby", e.target.value);
      u.searchParams.delete("paged");
      ir(u.toString(), true);
    });

    window.addEventListener("popstate", function () {
      ir(window.location.href, false);
    });
  }

  /* Banners de la portada ------------------------------------------------
     Sin JS se ve la primera diapositiva y se llega igual a todos los
     enlaces: las otras están en el HTML, sólo con el atributo hidden. */

  var caja = document.querySelector("[data-li-banners]");

  if (caja) {
    var slides = caja.querySelectorAll("[data-li-slide]");
    var puntos = caja.querySelectorAll("[data-li-banner-ir]");
    var actual = 0;
    var reloj = null;
    var quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var mostrar = function (i) {
      actual = (i + slides.length) % slides.length;

      for (var s = 0; s < slides.length; s++) {
        slides[s].hidden = s !== actual;
      }
      for (var p = 0; p < puntos.length; p++) {
        var activo = p === actual;
        puntos[p].classList.toggle("es-activo", activo);
        puntos[p].setAttribute("aria-selected", String(activo));
      }
    };

    var arrancar = function () {
      if (quieto || reloj) return;
      reloj = window.setInterval(function () {
        mostrar(actual + 1);
      }, 7000);
    };

    var frenar = function () {
      window.clearInterval(reloj);
      reloj = null;
    };

    // Tocar un control es una intención explícita: el giro automático para.
    var manual = function (i) {
      frenar();
      mostrar(i);
    };

    caja.querySelector("[data-li-banner-prev]").addEventListener("click", function () {
      manual(actual - 1);
    });

    caja.querySelector("[data-li-banner-next]").addEventListener("click", function () {
      manual(actual + 1);
    });

    for (var k = 0; k < puntos.length; k++) {
      (function (i) {
        puntos[i].addEventListener("click", function () {
          manual(i);
        });
      })(k);
    }

    caja.addEventListener("mouseenter", frenar);
    caja.addEventListener("focusin", frenar);
    caja.addEventListener("mouseleave", arrancar);

    // En una pestaña de fondo no hay nadie mirando.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) frenar();
      else arrancar();
    });

    arrancar();
  }
})();
