/* Tests de détection OS/navigateur/version (node --test).
 * Table d'User-Agents réels -> caseId attendu. Pur, pas de DOM. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEnv, buildGuide, ALL_CASES, guideByCaseId } from "./install-detect.js";

const UA = {
  iosSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iosSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iosSafari164:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
  ipadOS26:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/121.0 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/604.1",
  iosGmail:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/332.0.642241799 Safari/604.1",
  iosFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidFirefox:
    "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
  macSafari17:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  macSafari18:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari16:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  firefoxDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
};

const CASES = [
  ["iosSafari26", {}, "ios-safari-26"],
  ["iosSafari18", {}, "ios-safari"],
  ["iosSafari164", {}, "ios-safari"],
  ["ipadOS26", { maxTouchPoints: 5 }, "ios-safari-26"],
  ["iosChrome", {}, "ios-chrome"],
  ["iosEdge", {}, "ios-edge"],
  ["iosFirefox", {}, "ios-firefox"],
  ["iosGmail", {}, "ios-inapp"],
  ["iosFacebook", {}, "ios-inapp"],
  ["iosInstagram", {}, "ios-inapp"],
  ["androidChrome", {}, "android-chrome"],
  ["androidChrome", { hasPrompt: true }, "android-native"],
  ["androidSamsung", {}, "android-samsung"],
  ["androidFirefox", {}, "android-firefox"],
  ["androidEdge", {}, "android-edge"],
  ["macSafari17", {}, "mac-safari"],
  ["macSafari18", {}, "mac-safari"],
  ["macSafari16", {}, "safari-old"],
  ["macChrome", {}, "desktop-chrome"],
  ["macChrome", { hasPrompt: true }, "desktop-native"],
  ["winEdge", {}, "desktop-edge"],
  ["winChrome", { hasPrompt: true }, "desktop-native"],
  ["firefoxDesktop", {}, "firefox-desktop"],
];

for (const [name, opts, expected] of CASES) {
  test(`${name} ${JSON.stringify(opts)} -> ${expected}`, () => {
    const env = detectEnv(UA[name], opts);
    assert.equal(env.caseId, expected, `UA=${UA[name]} got os=${env.os} browser=${env.browser} v=${env.version}`);
  });
}

test("Gmail iOS : nom d'app détecté + guide in-app avec copie du lien", () => {
  const env = detectEnv(UA.iosGmail, {});
  assert.equal(env.isInApp, true);
  assert.match(env.inAppName, /Gmail/);
  const g = buildGuide(env);
  assert.equal(g.inApp, true);
  assert.match(g.intro, /Gmail/);
});

test("Android avec invite native : guide installable + libellé bouton", () => {
  const g = buildGuide(detectEnv(UA.androidChrome, { hasPrompt: true }));
  assert.equal(g.canNativePrompt, true);
  assert.equal(g.buttonLabel, "Installer l'appli");
});

test("Chaque cas a un guide avec au moins une étape", () => {
  for (const { caseId } of ALL_CASES) {
    const g = guideByCaseId(caseId);
    assert.ok(g.steps.length >= 1, `cas ${caseId} sans étape`);
    assert.ok(g.device && g.buttonLabel);
  }
});

test("buildGuide cas inconnu -> contenu de repli (unsupported)", () => {
  const g = buildGuide({ caseId: "nimporte" });
  assert.equal(g.device, "Autre appareil"); // contenu de CASES.unsupported
  assert.ok(g.steps.length >= 1);
});
