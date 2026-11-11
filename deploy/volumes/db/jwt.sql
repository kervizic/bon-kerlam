-- Expose le secret JWT aux fonctions SQL (si besoin). Fresh init uniquement.
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "${JWT_EXPIRY:-3600}"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
