/* ==========================================================================
   Pages de compte : petits comportements, sans aucune librairie.
   Tout est activé par des attributs data-* posés dans les gabarits, et les textes
   viennent aussi des gabarits (donc traduisibles) : ce fichier ne contient aucun libellé.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     BOUTON ŒIL : affiche ou masque le mot de passe.
     <button data-oeil="id-du-champ" aria-pressed="false"
             data-libelle-afficher="…" data-libelle-masquer="…">
     aria-pressed et aria-label sont mis à jour pour les lecteurs d'écran.
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-oeil]').forEach(function (bouton) {
    var champ = document.getElementById(bouton.getAttribute('data-oeil'));
    if (!champ) return;
    bouton.addEventListener('click', function () {
      var afficher = champ.type === 'password';
      champ.type = afficher ? 'text' : 'password';
      bouton.setAttribute('aria-pressed', afficher ? 'true' : 'false');
      bouton.setAttribute('aria-label', bouton.getAttribute(afficher ? 'data-libelle-masquer' : 'data-libelle-afficher'));
    });
  });

  /* ------------------------------------------------------------------
     INDICATEUR DE FORCE du mot de passe + règles cochées en direct.
     C'est INDICATIF : calculé ici, dans le navigateur. La vraie validation se fait côté serveur
     (AUTH_PASSWORD_VALIDATORS), et peut refuser un mot de passe que cet indicateur trouve « bon »
     (par exemple un mot de passe trop courant).

     Niveaux (de 1 à 4) : on compte des points ; en dessous de la longueur minimale, ou avec
     uniquement des chiffres, on reste au niveau 1.
       +1 longueur minimale atteinte        +1 au moins 12 caractères
       +1 lettres ET chiffres               +1 majuscules et minuscules, ou un symbole
     Le texte de chaque niveau vient de data-niveau-1…4 ; la longueur minimale de data-longueur-min.
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-force-champ]').forEach(function (bloc) {
    var champ = document.getElementById(bloc.getAttribute('data-force-champ'));
    if (!champ) return;
    var minimum = parseInt(bloc.getAttribute('data-longueur-min'), 10) || 8;
    var texte = bloc.querySelector('.force-niveau');
    var regles = document.querySelectorAll('[data-regles-champ="' + champ.id + '"] [data-regle]');

    function evaluer(valeur) {
      var longueur = valeur.length >= minimum;
      var seulementChiffres = /^\d+$/.test(valeur);
      var lettres = /[A-Za-zÀ-ÿ]/.test(valeur);
      var chiffres = /\d/.test(valeur);
      var melange = lettres && (chiffres || /[^A-Za-zÀ-ÿ0-9\s]/.test(valeur));
      var niveau = 0;
      if (valeur) {
        niveau = 1;
        if (longueur && !seulementChiffres) {
          var points = 0;
          if (valeur.length >= 12) points++;
          if (lettres && chiffres) points++;
          if ((/[a-zà-ÿ]/.test(valeur) && /[A-ZÀ-Þ]/.test(valeur)) || /[^A-Za-zÀ-ÿ0-9\s]/.test(valeur)) points++;
          niveau = 1 + Math.min(points, 3);
        }
      }
      return { niveau: niveau, longueur: longueur, pasChiffres: valeur !== '' && !seulementChiffres, melange: melange };
    }

    function actualiser() {
      var etat = evaluer(champ.value);
      bloc.setAttribute('data-niveau', String(etat.niveau));
      if (texte) texte.textContent = etat.niveau ? bloc.getAttribute('data-niveau-' + etat.niveau) : '';
      regles.forEach(function (regle) {
        var nom = regle.getAttribute('data-regle');
        var ok = nom === 'longueur' ? etat.longueur : nom === 'pas-chiffres' ? etat.pasChiffres : etat.melange;
        regle.setAttribute('data-ok', ok ? 'true' : 'false');
      });
    }
    champ.addEventListener('input', actualiser);
    actualiser();
  });

  /* ------------------------------------------------------------------
     ÉTAT « CHARGEMENT » à l'envoi : le bouton affiche un spinner et son texte
     change (data-libelle-chargement), puis il est désactivé pour éviter un double
     envoi. On désactive APRÈS l'envoi (setTimeout) : désactiver pendant l'événement
     empêcherait la soumission. Si la page revient de l'historique, on remet l'état normal.
     ------------------------------------------------------------------ */
  document.querySelectorAll('form[data-chargement]').forEach(function (formulaire) {
    var bouton = formulaire.querySelector('.btn-principal');
    if (!bouton) return;
    var libelle = bouton.querySelector('.btn-libelle');
    var texteInitial = libelle ? libelle.textContent : '';

    formulaire.addEventListener('submit', function () {
      if (bouton.getAttribute('aria-busy') === 'true') return;
      bouton.setAttribute('aria-busy', 'true');
      if (libelle) libelle.textContent = formulaire.getAttribute('data-libelle-chargement') || texteInitial;
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      bouton.insertBefore(spinner, bouton.firstChild);
      setTimeout(function () { bouton.disabled = true; }, 0);
    });

    window.addEventListener('pageshow', function (evenement) {
      if (!evenement.persisted) return;
      bouton.disabled = false;
      bouton.removeAttribute('aria-busy');
      if (libelle) libelle.textContent = texteInitial;
      var spinner = bouton.querySelector('.spinner');
      if (spinner) spinner.remove();
    });
  });

  /* ------------------------------------------------------------------
     VALIDATION LÉGÈRE de l'e-mail, à la sortie du champ (blur). Elle ne bloque
     jamais la saisie ni l'envoi : le serveur reste seul juge. Le message vient de
     data-message-email. L'erreur disparaît dès que le format redevient correct.
     ------------------------------------------------------------------ */
  document.querySelectorAll('input[data-valider-email]').forEach(function (champ) {
    var message = null;
    function retirer() {
      if (message) { message.remove(); message = null; }
      if (!champ.hasAttribute('data-erreur-serveur')) {
        champ.removeAttribute('aria-invalid');
        champ.removeAttribute('aria-describedby');
      }
    }
    function verifier() {
      var invalide = champ.value.trim() !== '' && !champ.checkValidity();
      if (!invalide) { retirer(); return; }
      if (message) return;
      message = document.createElement('p');
      message.className = 'champ-erreur';
      message.id = champ.id + '-erreur-js';
      message.textContent = champ.getAttribute('data-message-email') || '';
      champ.insertAdjacentElement('afterend', message);
      champ.setAttribute('aria-invalid', 'true');
      champ.setAttribute('aria-describedby', message.id);
    }
    if (champ.getAttribute('aria-invalid') === 'true') champ.setAttribute('data-erreur-serveur', '1');
    champ.addEventListener('blur', verifier);
    champ.addEventListener('input', function () { if (message) verifier(); });
  });

  /* ------------------------------------------------------------------
     FOCUS AUTOMATIQUE sur le premier champ, UNIQUEMENT sur ordinateur (souris + grand écran) :
     sur téléphone, il ouvrirait le clavier et cacherait le formulaire.
     ------------------------------------------------------------------ */
  if (window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches) {
    var invalide = document.querySelector('.champ[aria-invalid="true"]');
    var premier = invalide || document.querySelector('[data-autofocus]');
    if (premier) premier.focus();
  }

  /* ------------------------------------------------------------------
     LIEN « RETOUR » : revient à la page précédente si elle est du même site
     (par exemple l'événement qu'on était en train de réserver) ; sinon le lien
     normal vers l'accueil fait son travail.
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-retour]').forEach(function (lien) {
    lien.addEventListener('click', function (evenement) {
      var precedente = document.referrer;
      if (precedente && precedente.indexOf(window.location.origin) === 0 && precedente !== window.location.href) {
        evenement.preventDefault();
        window.history.back();
      }
    });
  });
})();
