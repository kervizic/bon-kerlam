/* Tests de détection install-detect.js — `node --test front/assets/install-detect.test.mjs`
 * Table d'User-Agents réels -> caseId attendu. */
import test from "node:test";
import assert from "node:assert/strict";
import { detectEnv, buildGuide, ALL_CASES } from "./install-detect.js";

const CASES = [
  // iOS 26 Safari (barre compacte)
  ["iOS 26 Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-safari-26"],
  // iPad iPadOS 26 (se présente en Macintosh tactile)
  ["iPadOS 26 Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", { maxTouchPoints: 5 }, "ios-safari-26"],
  // iOS 18 Safari
  ["iOS 18 Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-safari"],
  // iOS 16.4 Safari
  ["iOS 16 Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-safari"],
  // Chrome iOS
  ["iOS Chrome", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-chrome"],
  // Edge iOS
  ["iOS Edge", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-edge"],
  // Firefox iOS
  ["iOS Firefox", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-firefox"],
  // Gmail (Google Search App) in-app iOS
  ["iOS Gmail (GSA)", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/330.0 Mobile/15E148 Safari/604.1", { maxTouchPoints: 5 }, "ios-inapp"],
  // Facebook in-app iOS (pas de "Safari/")
  ["iOS Facebook", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]", { maxTouchPoints: 5 }, "ios-inapp"],
  // Instagram in-app iOS
  ["iOS Instagram", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0", { maxTouchPoints: 5 }, "ios-inapp"],
  // Android Chrome sans prompt
  ["Android Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36", {}, "android-chrome"],
  // Android Chrome AVEC prompt -> natif
  ["Android Chrome prompt", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36", { hasPrompt: true }, "android-native"],
  // Samsung Internet
  ["Android Samsung", "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36", {}, "android-samsung"],
  // Firefox Android
  ["Android Firefox", "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0", {}, "android-firefox"],
  // Edge Android
  ["Android Edge", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 EdgA/128.0.0.0", {}, "android-edge"],
  // Mac Safari 17/18/26
  ["Mac Safari 17", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", { maxTouchPoints: 0 }, "mac-safari"],
  ["Mac Safari 18", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", { maxTouchPoints: 0 }, "mac-safari"],
  ["Mac Safari 26", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", { maxTouchPoints: 0 }, "mac-safari"],
  // Mac Chrome
  ["Mac Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", {}, "desktop-chrome"],
  ["Mac Chrome prompt", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", { hasPrompt: true }, "desktop-native"],
  // Windows Edge
  ["Windows Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0", {}, "desktop-edge"],
  // Firefox desktop
  ["Windows Firefox", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", {}, "firefox-desktop"],
];

for (const [label, ua, opts, expected] of CASES) {
  test(label + " -> " + expected, () => {
    const env = detectEnv(ua, opts);
    assert.equal(env.caseId, expected, `${label}: got ${env.caseId} (os=${env.os} browser=${env.browser} v=${env.version})`);
    const guide = buildGuide(env);
    assert.ok(guide.steps.length >= 1, "au moins une étape");
    assert.ok(guide.buttonLabel, "un libellé de bouton");
  });
}

test("android native -> bouton 'Installer l'appli' + canNativePrompt", () => {
  const g = buildGuide(detectEnv("Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36", { hasPrompt: true }));
  assert.equal(g.canNativePrompt, true);
  assert.equal(g.buttonLabel, "Installer l'appli");
});

test("in-app intro mentionne le nom de l'application", () => {
  const g = buildGuide(detectEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 GSA/330 Mobile/15E148", { maxTouchPoints: 5 }));
  assert.match(g.intro, /Gmail/);
});

test("ALL_CASES couvre tous les grands OS", () => {
  assert.ok(ALL_CASES.length >= 10);
  for (const c of ALL_CASES) assert.ok(c.device && c.caseId);
});
