/* ==========================================================================
   Espace organisateur : aperçu des images avant l'envoi et réordonnancement de la galerie.
   Aucune librairie. Les textes viennent des gabarits (attributs data-*), donc traduisibles.
   Ce que fait ce fichier n'est qu'un CONFORT : le serveur revérifie tout (format, poids, dimensions).
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     APERÇU AVANT ENVOI : quand on choisit une image, on l'affiche tout de suite
     (URL.createObjectURL : l'image reste dans le navigateur, rien n'est envoyé).
     Si elle dépasse le poids maximum (data-max-octets), on prévient immédiatement.
     ------------------------------------------------------------------ */
  document.querySelectorAll('form[data-formulaire-image]').forEach(function (formulaire) {
    var champ = formulaire.querySelector('input[type="file"][data-apercu]');
    var cible = formulaire.querySelector('[data-apercu-cible]');
    if (!champ || !cible) return;
    var maximum = parseInt(formulaire.getAttribute('data-max-octets'), 10) || 0;
    var adresse = null;

    champ.addEventListener('change', function () {
      if (adresse) { URL.revokeObjectURL(adresse); adresse = null; }
      cible.textContent = '';
      var fichier = champ.files && champ.files[0];
      if (!fichier) return;

      var miniature = document.createElement('img');
      adresse = URL.createObjectURL(fichier);
      miniature.src = adresse;
      miniature.alt = '';
      var texte = document.createElement('p');
      texte.className = 'orga-apercu-texte';
      texte.textContent = fichier.name + ' (' + (fichier.size / 1048576).toFixed(1) + ' Mo)';
      if (maximum && fichier.size > maximum) {
        texte.className += ' est-erreur';
        texte.textContent += ' — ' + (formulaire.getAttribute('data-libelle-trop-lourd') || '');
      }
      cible.appendChild(miniature);
      cible.appendChild(texte);
    });
  });

  /* ------------------------------------------------------------------
     RÉORDONNANCEMENT DE LA GALERIE : les boutons ↑ ↓ déplacent une image dans la liste,
     puis le champ caché « ordre » de chaque image est renuméroté (0, 1, 2…) pour l'envoi.
     Les boutons marchent au clavier et au doigt ; sans JavaScript, l'ordre reste modifiable
     en conservant les valeurs actuelles.
     ------------------------------------------------------------------ */
  document.querySelectorAll('form[data-galerie]').forEach(function (formulaire) {
    var liste = formulaire.querySelector('.orga-galerie');
    if (!liste) return;

    function renumeroter() {
      liste.querySelectorAll('[data-item]').forEach(function (item, index) {
        var ordre = item.querySelector('input[name$="-ordre"]');
        if (ordre) ordre.value = String(index);
      });
    }

    liste.addEventListener('click', function (evenement) {
      var bouton = evenement.target.closest('[data-monter], [data-descendre]');
      if (!bouton) return;
      var item = bouton.closest('[data-item]');
      if (bouton.hasAttribute('data-monter') && item.previousElementSibling) {
        liste.insertBefore(item, item.previousElementSibling);
      } else if (bouton.hasAttribute('data-descendre') && item.nextElementSibling) {
        liste.insertBefore(item.nextElementSibling, item);
      }
      renumeroter();
      bouton.focus();   // le focus reste sur le bouton utilisé, pour enchaîner au clavier
    });
    formulaire.addEventListener('submit', renumeroter);
  });
})();
