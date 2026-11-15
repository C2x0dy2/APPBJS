/* ==========================================================================
   Effets du site. Aucune librairie.

   Principe : un élément déclare ses effets avec data-effect="nom1 nom2".
   Au chargement, chaque nom est associé à une fonction ci-dessous, appelée une
   fois pour CHAQUE élément concerné. Un effet peut donc apparaître plusieurs
   fois sur la page sans code supplémentaire.
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var effects = {

    /* ------------------------------------------------------------------
       CARROUSEL : boutons précédent / suivant pour le défilement horizontal.
       Le défilement lui-même (au doigt, au clavier, avec accroche sur chaque
       carte) est fait en CSS (scroll-snap). Le JavaScript sert seulement aux
       boutons, qui font défiler d'une carte à la fois et se désactivent aux
       extrémités.
       Attendus dans l'élément : [data-carousel-track], [data-carousel-prev],
       [data-carousel-next].
       ------------------------------------------------------------------ */
    carousel: function (root) {
      var track = root.querySelector('[data-carousel-track]');
      var prev = root.querySelector('[data-carousel-prev]');
      var next = root.querySelector('[data-carousel-next]');
      if (!track || !prev || !next) return;

      function step() {
        var item = track.querySelector('li');
        if (!item) return track.clientWidth * 0.8;
        var gap = parseFloat(getComputedStyle(item.parentElement).columnGap) || 0;
        return item.getBoundingClientRect().width + gap;
      }
      function scrollByStep(dir) {
        track.scrollBy({ left: dir * step(), behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      function update() {
        var max = track.scrollWidth - track.clientWidth - 2;
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= max;
      }

      prev.addEventListener('click', function () { scrollByStep(-1); });
      next.addEventListener('click', function () { scrollByStep(1); });

      var ticking = false;   // on limite la mise à jour à une fois par image affichée
      track.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () { update(); ticking = false; });
      }, { passive: true });
      window.addEventListener('resize', update);
      update();
    },

    /* ------------------------------------------------------------------
       HEURE LOCALE : pour un événement en ligne, affiche l'heure chez le
       visiteur, dans SA langue et SON fuseau (celui de son navigateur).
       Attendus : data-utc (instant ISO) et data-label (texte devant l'heure,
       fourni par le gabarit, donc traduisible). Sans JavaScript, la ligne
       reste vide : l'heure du lieu est déjà affichée à côté.
       ------------------------------------------------------------------ */
    /* ------------------------------------------------------------------
       NOTIFICATION : se ferme toute seule après quelques secondes, ou au clic
       sur la croix. Le texte est dans la page (lu par les lecteurs d'écran).
       ------------------------------------------------------------------ */
    toast: function (el) {
      var fermer = function () { el.remove(); };
      var bouton = el.querySelector('.toast-x');
      if (bouton) bouton.addEventListener('click', fermer);
      setTimeout(fermer, 6000);
    },

    'local-time': function (el) {
      var quand = new Date(el.getAttribute('data-utc'));
      if (isNaN(quand)) return;
      var texte = quand.toLocaleString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      });
      el.textContent = (el.getAttribute('data-label') || '') + ' : ' + texte;
    }
  };

  document.querySelectorAll('[data-effect]').forEach(function (el) {
    el.getAttribute('data-effect').split(/\s+/).forEach(function (name) {
      if (effects[name]) effects[name](el);
    });
  });
})();
