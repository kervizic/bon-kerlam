/* config.example.js — modèle de configuration de déploiement.
 *
 * À chaque déploiement, ce fichier (ou un équivalent généré par la CI) est copié
 * en `config.js` avec les vraies valeurs d'environnement. `config.js` n'est PAS
 * un module ES : il est chargé en <script> classique, avant le vendor supabase-js
 * et avant app.js (module), pour garantir que `window.BON_CFG` existe déjà quand
 * le reste du shell s'exécute.
 *
 * Ne jamais committer de vraie clé ici : seules des valeurs d'exemple.
 */
window.BON_CFG = {
  // URL de base de l'instance Supabase self-hosted (PostgREST derrière le reverse proxy).
  API_URL: "https://api.kerlam.fr",

  // Clé publique "anon" (JWT). Volontairement limitée côté RLS : cf. supabase/migrations/0004_rls.sql.
  ANON_KEY: "<anon-jwt>",

  // Active le bouton de connexion Google (GoTrue provider "google").
  GOOGLE_ENABLED: true,
};
