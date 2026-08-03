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
})();
