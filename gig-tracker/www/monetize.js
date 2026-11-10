'use strict';
/* Subscriptions (RevenueCat) and ads (Google AdMob).
   Free users see a banner above the tab bar and an occasional full-screen ad after saving.
   An active "pro" entitlement removes every ad. Both only run inside the native app. */

const MM = window.MILEMONEY_CONFIG || {};
const PLATFORM = NATIVE ? Cap.getPlatform() : 'web';

/* ---------- Pro subscription ---------- */
const Pro = (() => {
  const cfg = MM.revenueCat || {};
  const Purchases = plugin('Purchases');
  const key = PLATFORM === 'ios' ? cfg.appleApiKey : PLATFORM === 'android' ? cfg.googleApiKey : '';
  const enabled = !!(Purchases && key);
  const ENT = cfg.entitlement || 'pro';
  const devUnlock = cfg.devUnlockPro === true;
  const CACHE = 'milemoney.pro';
  let active = false;
  try { active = localStorage.getItem(CACHE) === '1'; } catch (_) { /* no storage */ }
  let info = null, configured = false;
  const listeners = new Set();

  function fromInfo(ci) {
    info = ci || info;
    const ent = ci && ci.entitlements && ci.entitlements.active && ci.entitlements.active[ENT];
    const next = !!ent;
    try { localStorage.setItem(CACHE, next ? '1' : '0'); } catch (_) { /* ignore */ }
    if (next !== active) { active = next; listeners.forEach((f) => f()); }
  }

  async function init(userId) {
    if (!enabled) return;
    try {
      await Purchases.configure({ apiKey: key, appUserID: userId || null });
      configured = true;
      await Purchases.addCustomerInfoUpdateListener((ci) => fromInfo(ci));
      const { customerInfo } = await Purchases.getCustomerInfo();
      fromInfo(customerInfo);
    } catch (e) { console.warn('Purchases init failed', e); }
  }

  // Tie purchases to the MileMoney account so Pro follows the user to other phones.
  async function identify(userId) {
    if (!configured) return;
    try {
      if (userId) { const { customerInfo } = await Purchases.logIn({ appUserID: userId }); fromInfo(customerInfo); }
      else { const { customerInfo } = await Purchases.logOut(); fromInfo(customerInfo); }
    } catch (_) { /* logOut throws when already anonymous */ }
  }

  async function packages() {
    if (!configured) return [];
    const offerings = await Purchases.getOfferings();
    return (offerings.current && offerings.current.availablePackages) || [];
  }

  const cancelled = (e) => e && (e.userCancelled || String(e.code) === '1' || /cancel/i.test(e.message || ''));
  async function buy(pkg) {
    try {
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
      fromInfo(customerInfo);
      return active;
    } catch (e) {
      if (cancelled(e)) return false;
      throw e;
    }
  }
  async function restore() {
    const { customerInfo } = await Purchases.restorePurchases();
    fromInfo(customerInfo);
    return active;
  }

  return {
    enabled, init, identify, packages, buy, restore,
    get active() { return active || devUnlock; },
    get manageUrl() { return (info && info.managementURL) || (PLATFORM === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions'); },
    get expires() { const e = info && info.entitlements && info.entitlements.active && info.entitlements.active[ENT]; return e ? e.expirationDate : null; },
    get willRenew() { const e = info && info.entitlements && info.entitlements.active && info.entitlements.active[ENT]; return e ? e.willRenew : false; },
    on: (f) => listeners.add(f),
  };
})();

/* ---------- Ads ---------- */
const Ads = (() => {
  const cfg = MM.admob || {};
  const AdMob = plugin('AdMob');
  const enabled = !!AdMob && (PLATFORM === 'ios' || PLATFORM === 'android');
  // Google's public test ad units. Real IDs go in config.js before release.
  const TEST = {
    android: { banner: 'ca-app-pub-3940256099942544/6300978111', interstitial: 'ca-app-pub-3940256099942544/1033173712' },
    ios: { banner: 'ca-app-pub-3940256099942544/2934735716', interstitial: 'ca-app-pub-3940256099942544/4411468910' },
  };
  const testing = cfg.useTestAds !== false;
  const unit = (kind) => {
    const real = PLATFORM === 'ios' ? cfg[`ios${kind === 'banner' ? 'Banner' : 'Interstitial'}Id`] : cfg[`android${kind === 'banner' ? 'Banner' : 'Interstitial'}Id`];
    return !testing && real ? real : (TEST[PLATFORM] || TEST.android)[kind];
  };

  let ready = false, bannerUp = false, bannerCreated = false, paused = false;
  let interstitialLoaded = false, lastInterstitial = Date.now(), saves = 0;
  const INTERSTITIAL_EVERY = 4;               // saves between full-screen ads
  const INTERSTITIAL_GAP = 10 * 60 * 1000;    // and at least 10 minutes apart

  function setHeight(h) { document.documentElement.style.setProperty('--ad-h', (h > 0 ? h + 8 : 0) + 'px'); }

  async function init() {
    if (!enabled || ready || Pro.active) return;
    try {
      await AdMob.initialize({ initializeForTesting: testing });
      if (PLATFORM === 'ios') {
        try {
          const s = await AdMob.trackingAuthorizationStatus();
          if (s.status === 'notDetermined') await AdMob.requestTrackingAuthorization();
        } catch (_) { /* older iOS */ }
      }
      // EU/UK privacy consent (Google's consent form); shown only where the law requires it.
      try {
        let c = await AdMob.requestConsentInfo();
        if (c.isConsentFormAvailable && c.status === 'REQUIRED') c = await AdMob.showConsentForm();
        if (c.canRequestAds === false) return;
      } catch (_) { /* consent service unreachable: ads may still load as non-personalized */ }
      await AdMob.addListener('bannerAdSizeChanged', (s) => { if (bannerUp) setHeight(s.height); });
      await AdMob.addListener('bannerAdFailedToLoad', () => setHeight(0));
      await AdMob.addListener('interstitialAdDismissed', () => { interstitialLoaded = false; preload(); });
      ready = true;
      refresh();
      preload();
    } catch (e) { console.warn('AdMob init failed', e); }
  }

  function bottomMargin() {
    const dock = document.getElementById('dock');
    if (!dock) return 90;
    return Math.round(window.innerHeight - dock.getBoundingClientRect().top + 8);
  }

  async function show() {
    if (bannerUp) return;
    bannerUp = true;
    try {
      if (bannerCreated) await AdMob.resumeBanner();
      else {
        await AdMob.showBanner({ adId: unit('banner'), adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: bottomMargin(), isTesting: testing });
        bannerCreated = true;
      }
    } catch (e) { bannerUp = false; setHeight(0); }
  }
  async function hide(remove) {
    if (!bannerCreated) return;
    bannerUp = false; setHeight(0);
    try {
      if (remove) { await AdMob.removeBanner(); bannerCreated = false; } else await AdMob.hideBanner();
    } catch (_) { /* ignore */ }
  }
  function refresh() {
    if (!enabled) return;
    if (Pro.active) { hide(true); return; }
    if (!ready) { init(); return; }
    if (paused) hide(false); else show();
  }

  async function preload() {
    if (!ready || Pro.active || interstitialLoaded) return;
    try { await AdMob.prepareInterstitial({ adId: unit('interstitial'), isTesting: testing }); interstitialLoaded = true; } catch (_) { /* try again later */ }
  }
  // Called after the user saves something. Never interrupts an active shift.
  async function afterSave() {
    if (!ready || Pro.active) return;
    saves++;
    if (db.track || saves % INTERSTITIAL_EVERY !== 0 || Date.now() - lastInterstitial < INTERSTITIAL_GAP) return;
    if (!interstitialLoaded) { preload(); return; }
    lastInterstitial = Date.now();
    try { await AdMob.showInterstitial(); } catch (_) { /* not ready */ }
    interstitialLoaded = false;
  }

  Pro.on(refresh);
  return {
    enabled, init, refresh, afterSave,
    pause() { paused = true; refresh(); },      // while a sheet is open (the banner would cover its buttons)
    resume() { paused = false; refresh(); },
    get showing() { return enabled && !Pro.active; },
    privacyOptions: () => AdMob && AdMob.showPrivacyOptionsForm().catch(() => {}),
  };
})();
