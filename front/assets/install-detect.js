/* install-detect.js — détection OS + navigateur + version et contenu des guides
 * d'installation PWA. Module PUR (aucun accès au DOM) : importable dans le
 * navigateur ET sous Node (tests). Les libellés reprennent EXACTEMENT ceux des
 * interfaces en français. Pictos SVG renvoyés comme chaînes inline (CSP-safe).
 *
 * API :
 *   detectEnv(ua, { maxTouchPoints, standalone, hasPrompt }) -> env
 *   buildGuide(env) -> { caseId, device, title, canNativePrompt, buttonLabel,
 *                        intro, steps:[{icon,title,detail}], note, recommend }
 *   ALL_CASES -> [{ caseId, device }] (pour « autres appareils »)
 *   ICONS[key] -> svg string
 */

export const ICONS = {
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"/></svg>',
  dots:
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  kebab:
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  hamburger:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  plus_square:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  install:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  dock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M4 20h16M8 20v-4M16 20v-4"/></svg>',
  addressbar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="3"/><path d="M15 12h3M16.5 10.5l1.5 1.5-1.5 1.5"/></svg>',
  safari:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  arrow_down_bar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><rect x="4" y="18" width="16" height="3" rx="1.5"/></svg>',
};

function num(re, ua) {
  const m = ua.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

/** Détecte OS, navigateur, version et contexte. Pur (pas de globals). */
export function detectEnv(ua, opts = {}) {
  ua = ua || "";
  const maxTouch = opts.maxTouchPoints || 0;
  const standalone = !!opts.standalone;
  const hasPrompt = !!opts.hasPrompt;

  const isIpad13 = /Macintosh/.test(ua) && maxTouch > 1;
  const isIos = /iPhone|iPad|iPod/.test(ua) || isIpad13;
  const isAndroid = /Android/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIos;
  const isWindows = /Windows NT/.test(ua);
  const isLinux = /Linux/.test(ua) && !isAndroid && !isIos;

  let os = "autre";
  if (isIos) os = /iPad/.test(ua) || isIpad13 ? "ipados" : "ios";
  else if (isAndroid) os = "android";
  else if (isMac) os = "macos";
  else if (isWindows) os = "windows";
  else if (isLinux) os = "linux";

  // Navigateurs intégrés iOS (webview, pas Safari ni un vrai navigateur tiers).
  const inAppMap = [
    [/GSA\//, "Google (Gmail)"],
    [/FBAN|FBAV|FB_IAB/, "Facebook"],
    [/Instagram/, "Instagram"],
    [/\bLine\//, "LINE"],
    [/WhatsApp/, "WhatsApp"],
    [/Snapchat/, "Snapchat"],
    [/LinkedInApp/, "LinkedIn"],
    [/\bOutlook-iOS\b|MSAuthHost|\bOutlook\b/, "Outlook"],
    [/Pinterest/, "Pinterest"],
  ];

  let browser = "autre";
  let version = 0;
  let isInApp = false;
  let inAppName = "";

  if (isIos) {
    if (/CriOS\//.test(ua)) { browser = "ios-chrome"; version = num(/CriOS\/(\d+)/, ua); }
    else if (/EdgiOS\//.test(ua)) { browser = "ios-edge"; version = num(/EdgiOS\/(\d+)/, ua); }
    else if (/FxiOS\//.test(ua)) { browser = "ios-firefox"; version = num(/FxiOS\/(\d+)/, ua); }
    else if (/OPiOS\/|OPT\//.test(ua)) { browser = "ios-opera"; version = num(/(?:OPiOS|OPT)\/(\d+)/, ua); }
    else {
      const hit = inAppMap.find(([re]) => re.test(ua));
      // Vrai Safari : "Safari/" ET "Version/" présents, et aucun marqueur in-app.
      const looksSafari = /Version\/(\d+)/.test(ua) && /Safari\//.test(ua);
      if (hit && !looksSafari) { browser = "ios-inapp"; isInApp = true; inAppName = hit[1]; }
      else if (looksSafari) { browser = "ios-safari"; version = num(/Version\/(\d+)/, ua); }
      else { browser = "ios-inapp"; isInApp = true; inAppName = hit ? hit[1] : "une autre application"; }
    }
  } else if (isAndroid) {
    if (/SamsungBrowser\//.test(ua)) { browser = "android-samsung"; version = num(/SamsungBrowser\/(\d+)/, ua); }
    else if (/EdgA\//.test(ua)) { browser = "android-edge"; version = num(/EdgA\/(\d+)/, ua); }
    else if (/OPR\/|Opera/.test(ua)) { browser = "android-opera"; version = num(/OPR\/(\d+)/, ua); }
    else if (/Firefox\//.test(ua)) { browser = "android-firefox"; version = num(/Firefox\/(\d+)/, ua); }
    else if (/Chrome\//.test(ua)) { browser = "android-chrome"; version = num(/Chrome\/(\d+)/, ua); }
    else { browser = "android-other"; }
  } else {
    // Ordinateur.
    if (/Edg\//.test(ua)) { browser = "desktop-edge"; version = num(/Edg\/(\d+)/, ua); }
    else if (/OPR\//.test(ua)) { browser = "desktop-opera"; version = num(/OPR\/(\d+)/, ua); }
    else if (/Firefox\//.test(ua)) { browser = "desktop-firefox"; version = num(/Firefox\/(\d+)/, ua); }
    else if (/Chrome\//.test(ua)) { browser = "desktop-chrome"; version = num(/Chrome\/(\d+)/, ua); }
    else if (isMac && /Version\/(\d+).*Safari\//.test(ua)) { browser = "mac-safari"; version = num(/Version\/(\d+)/, ua); }
    else { browser = "desktop-other"; }
  }

  return { os, browser, version, isInApp, inAppName, standalone, hasPrompt, caseId: caseIdFor({ os, browser, version, hasPrompt }) };
}

function caseIdFor({ os, browser, version, hasPrompt }) {
  switch (browser) {
    case "ios-safari":
      return version >= 26 ? "ios-safari-26" : "ios-safari";
    case "ios-chrome": return "ios-chrome";
    case "ios-edge": return "ios-edge";
    case "ios-firefox": return "ios-firefox";
    case "ios-opera": return "ios-chrome"; // même parcours (menu Partager)
    case "ios-inapp": return "ios-inapp";
    case "android-chrome": return hasPrompt ? "android-native" : "android-chrome";
    case "android-edge": return hasPrompt ? "android-native" : "android-edge";
    case "android-samsung": return "android-samsung";
    case "android-firefox": return "android-firefox";
    case "android-opera": return "android-opera";
    case "android-other": return hasPrompt ? "android-native" : "android-other";
    case "mac-safari": return version >= 17 ? "mac-safari" : "safari-old";
    case "desktop-chrome": return hasPrompt ? "desktop-native" : "desktop-chrome";
    case "desktop-edge": return hasPrompt ? "desktop-native" : "desktop-edge";
    case "desktop-opera": return "desktop-chrome";
    case "desktop-firefox": return "firefox-desktop";
    default: return "unsupported";
  }
}

const S = (icon, title, detail) => ({ icon, title, detail });

/** Contenu de chaque cas. Renvoie une fonction (env) -> guide pour les cas qui
 * dépendent du contexte (nom de l'app in-app). */
const CASES = {
  "ios-safari-26": {
    device: "iPhone / iPad — Safari (iOS 26)",
    buttonLabel: "Comment installer",
    intro: "Sur iOS 26, le bouton Partager n'est plus visible directement dans la barre compacte.",
    steps: [
      S("dots", "Toucher « ••• »", "À droite de la barre d'adresse, en bas de l'écran."),
      S("share", "Choisir « Partager »", "Dans le menu qui s'ouvre."),
      S("plus_square", "« Sur l'écran d'accueil »", "Faites défiler la liste des actions."),
      S("check", "Laisser « Ouvrir comme app web » activé, puis « Ajouter »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
    note: "Si le bouton Partager apparaît directement dans votre barre, utilisez-le (voir « autres appareils »).",
  },
  "ios-safari": {
    device: "iPhone / iPad — Safari (iOS 16.4 à 18)",
    buttonLabel: "Comment installer",
    intro: "Dans Safari :",
    steps: [
      S("share", "Toucher le bouton Partager", "Le carré avec une flèche vers le haut — en bas sur iPhone, en haut à droite sur iPad."),
      S("plus_square", "« Sur l'écran d'accueil »", "Faites défiler la liste si besoin."),
      S("check", "Toucher « Ajouter »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
  },
  "ios-chrome": {
    device: "iPhone / iPad — Chrome, Edge ou Opera",
    buttonLabel: "Comment installer",
    intro: "Dans Chrome (ou Edge / Opera) sur iOS :",
    steps: [
      S("share", "Toucher le bouton Partager", "Dans la barre d'adresse (icône de partage)."),
      S("plus_square", "« Sur l'écran d'accueil »", "Faites défiler la liste des actions."),
      S("check", "Toucher « Ajouter »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
    recommend: "Pour un résultat optimal, Safari reste recommandé sur iPhone/iPad.",
  },
  "ios-edge": {
    device: "iPhone / iPad — Edge",
    buttonLabel: "Comment installer",
    intro: "Dans Edge sur iOS :",
    steps: [
      S("share", "Toucher le menu Partager", "Via le menu « … » puis Partager."),
      S("plus_square", "« Sur l'écran d'accueil »", "Faites défiler la liste des actions."),
      S("check", "Toucher « Ajouter »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
    recommend: "Safari reste recommandé sur iPhone/iPad.",
  },
  "ios-firefox": {
    device: "iPhone / iPad — Firefox",
    buttonLabel: "Comment installer",
    intro: "Firefox sur iOS n'installe pas de vraie application.",
    steps: [
      S("safari", "Ouvrir bon.kerlam.fr dans Safari", "Puis suivez les étapes de Safari."),
    ],
    recommend: "Sur iPhone/iPad, l'installation se fait depuis Safari.",
  },
  "ios-inapp": {
    device: "iPhone / iPad — navigateur intégré",
    buttonLabel: "Ouvrir dans Safari",
    intro: null, // rempli dynamiquement (nom de l'app)
    steps: [
      S("dots", "Ouvrir le menu de l'application", "Le bouton « ••• » ou « ⋯ »."),
      S("safari", "« Ouvrir dans Safari »", "Ou touchez l'icône boussole (Safari)."),
      S("plus_square", "Dans Safari : Partager → « Sur l'écran d'accueil » → « Ajouter »", "L'installation n'est possible que depuis Safari."),
    ],
    note: "Vous pouvez aussi copier le lien et le coller dans Safari.",
    inApp: true,
  },
  "android-native": {
    device: "Android — Chrome / Edge",
    buttonLabel: "Installer l'appli",
    intro: "Votre navigateur peut installer l'application en un geste :",
    steps: [
      S("install", "Toucher « Installer l'appli »", "Le bandeau d'installation du navigateur s'ouvre."),
      S("check", "Confirmer « Installer »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
    native: true,
  },
  "android-chrome": {
    device: "Android — Chrome",
    buttonLabel: "Comment installer",
    intro: "Dans Chrome :",
    steps: [
      S("kebab", "Ouvrir le menu « ⋮ »", "En haut à droite."),
      S("install", "« Ajouter à l'écran d'accueil »", "Puis « Installer »."),
    ],
  },
  "android-edge": {
    device: "Android — Edge",
    buttonLabel: "Comment installer",
    intro: "Dans Edge :",
    steps: [
      S("hamburger", "Ouvrir le menu « ≡ » (ou « … »)", "En bas de l'écran."),
      S("install", "« Ajouter au téléphone »", "Confirmez l'ajout."),
    ],
  },
  "android-samsung": {
    device: "Android — Samsung Internet",
    buttonLabel: "Comment installer",
    intro: "Dans Samsung Internet :",
    steps: [
      S("hamburger", "Ouvrir le menu « ≡ »", "En bas à droite."),
      S("plus_square", "« Ajouter la page à »", "Puis « Écran d'accueil »."),
      S("check", "Confirmer « Ajouter »", "L'icône KERLAM apparaît sur l'écran d'accueil."),
    ],
  },
  "android-firefox": {
    device: "Android — Firefox",
    buttonLabel: "Comment installer",
    intro: "Dans Firefox :",
    steps: [
      S("kebab", "Ouvrir le menu « ⋮ »", "En haut à droite."),
      S("install", "« Ajouter à l'écran d'accueil »", "Confirmez l'ajout."),
    ],
  },
  "android-opera": {
    device: "Android — Opera",
    buttonLabel: "Comment installer",
    intro: "Dans Opera :",
    steps: [
      S("kebab", "Ouvrir le menu Opera", "Le bouton de menu."),
      S("install", "« Ajouter à l'écran d'accueil »", "Confirmez l'ajout."),
    ],
  },
  "android-other": {
    device: "Android — autre navigateur",
    buttonLabel: "Comment installer",
    intro: "Dans le menu de votre navigateur :",
    steps: [
      S("kebab", "Ouvrir le menu du navigateur", "Icône « ⋮ » ou « ≡ »."),
      S("install", "« Ajouter à l'écran d'accueil »", "Ou « Installer l'application »."),
    ],
    recommend: "Chrome et Edge offrent l'installation la plus simple sur Android.",
  },
  "mac-safari": {
    device: "Mac — Safari (macOS Sonoma 14+)",
    buttonLabel: "Comment installer",
    intro: "Dans Safari sur Mac :",
    steps: [
      S("dock", "Menu « Fichier » → « Ajouter au Dock… »", "Ou le bouton Partager → « Ajouter au Dock »."),
      S("check", "Cliquer sur « Ajouter »", "L'app s'ouvre dans sa propre fenêtre, visible dans le Dock et le Launchpad."),
    ],
  },
  "desktop-native": {
    device: "Ordinateur — Chrome / Edge",
    buttonLabel: "Installer l'appli",
    intro: "Votre navigateur peut installer l'application :",
    steps: [
      S("install", "Cliquer sur « Installer l'appli »", "La fenêtre d'installation du navigateur s'ouvre."),
      S("check", "Confirmer « Installer »", "L'app s'ouvre dans sa propre fenêtre."),
    ],
    native: true,
  },
  "desktop-chrome": {
    device: "Ordinateur — Chrome",
    buttonLabel: "Comment installer",
    intro: "Dans Chrome :",
    steps: [
      S("addressbar", "Icône d'installation dans la barre d'adresse", "À droite de l'adresse (un écran avec une flèche)."),
      S("install", "Sinon : menu « ⋮ » → « Caster, enregistrer et partager » → « Installer la page en tant qu'application… »", "Puis confirmez « Installer »."),
    ],
  },
  "desktop-edge": {
    device: "Ordinateur — Edge",
    buttonLabel: "Comment installer",
    intro: "Dans Edge :",
    steps: [
      S("install", "Menu « … » → « Applications »", "Puis « Installer ce site en tant qu'application »."),
      S("check", "Confirmer « Installer »", "L'app s'ouvre dans sa propre fenêtre."),
    ],
  },
  "firefox-desktop": {
    device: "Ordinateur — Firefox",
    buttonLabel: "Autres options",
    intro: "Firefox pour ordinateur n'installe pas les applications web.",
    steps: [
      S("warn", "Utilisez Chrome ou Edge pour installer", "Ou ajoutez bon.kerlam.fr à vos favoris (Ctrl+D)."),
    ],
    recommend: "Pour une vraie application, ouvrez bon.kerlam.fr dans Chrome ou Edge.",
    unsupported: true,
  },
  "safari-old": {
    device: "Mac — Safari (ancienne version)",
    buttonLabel: "Autres options",
    intro: "Cette version de Safari ne permet pas d'ajouter l'app au Dock.",
    steps: [
      S("warn", "Mettre à jour macOS (Sonoma 14 ou plus)", "Puis Safari : Fichier → « Ajouter au Dock… »."),
      S("install", "Ou utiliser Chrome / Edge", "L'installation y est disponible."),
    ],
    unsupported: true,
  },
  unsupported: {
    device: "Autre appareil",
    buttonLabel: "Comment installer",
    intro: "Pour installer l'application :",
    steps: [
      S("install", "Ouvrir bon.kerlam.fr dans Chrome, Edge ou Safari", "Puis utilisez l'option d'installation / d'ajout à l'écran d'accueil du navigateur."),
    ],
    recommend: "Chrome, Edge (ordinateur/Android) et Safari (iPhone/iPad/Mac) sont pris en charge.",
  },
};

export const ALL_CASES = [
  "ios-safari-26", "ios-safari", "ios-chrome", "ios-inapp",
  "android-chrome", "android-samsung", "android-firefox",
  "mac-safari", "desktop-chrome", "desktop-edge", "firefox-desktop",
].map((caseId) => ({ caseId, device: CASES[caseId].device }));

export function buildGuide(env) {
  const base = CASES[env.caseId] || CASES.unsupported;
  const guide = {
    caseId: env.caseId,
    device: base.device,
    title: base.device,
    canNativePrompt: !!base.native,
    buttonLabel: base.native ? "Installer l'appli" : base.buttonLabel,
    intro: base.intro,
    steps: base.steps.map((s) => ({ ...s })),
    note: base.note || null,
    recommend: base.recommend || null,
    inApp: !!base.inApp,
    unsupported: !!base.unsupported,
  };
  if (base.inApp) {
    const name = env.inAppName || "une autre application";
    guide.intro = `Vous êtes dans le navigateur de ${name}. L'ajout à l'écran d'accueil n'y est pas disponible.`;
  }
  return guide;
}

/** Guide par identifiant de cas (pour la liste « autres appareils »). */
export function guideByCaseId(caseId, inAppName) {
  return buildGuide({ caseId, inAppName });
}
