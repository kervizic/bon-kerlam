/* config.js — configuration de DÉVELOPPEMENT local uniquement.
 *
 * En production, ce fichier est ÉCRASÉ au déploiement par les vraies valeurs
 * (cf. config.example.js et front/README.md « Déploiement »). Il est volontairement
 * versionné ici avec des valeurs placeholder pour que l'app charge sans erreur
 * en clone local / preview, même sans backend joignable (écran de login visible,
 * mais la connexion échouera proprement avec un message réseau).
 *
 * Chargé en <script> classique (PAS un module) avant vendor/supabase/supabase.js
 * et avant app.js : app.js lit `window.BON_CFG` dès son premier tick.
 */
window.BON_CFG = {
  API_URL: "http://localhost:54321",
  ANON_KEY: "local-dev-placeholder-anon-key",
  GOOGLE_ENABLED: true,
};
