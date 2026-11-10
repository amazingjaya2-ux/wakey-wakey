// MileMoney settings. Everything here is safe to ship inside the app: these are public keys.
// See README.md ("Turn on accounts", "Turn on subscriptions", "Turn on ads") for where each value comes from.
window.MILEMONEY_CONFIG = {
  // Accounts and cloud sync (Supabase > Project Settings > API).
  // Leave empty to run in local-only mode.
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Subscriptions (RevenueCat > Project > API keys > "Public app-specific API keys").
  // Leave empty and the app has no paywall (and no way to remove ads).
  revenueCat: {
    appleApiKey: '',   // starts with appl_
    googleApiKey: '',  // starts with goog_
    entitlement: 'pro', // the entitlement that unlocks Pro features and removes ads
    // Unlocks every Pro feature without a subscription, for trying the app before RevenueCat is
    // set up. Must be false in any build you publish.
    devUnlockPro: false,
  },

  // Ads (Google AdMob > Apps > Ad units). While useTestAds is true the app shows Google's
  // test ads, which is required during development: clicking your own real ads can get your
  // AdMob account banned. Set it to false only in the build you publish.
  // The AdMob *app* IDs go in android/app/src/main/AndroidManifest.xml and ios/App/App/Info.plist.
  admob: {
    useTestAds: true,
    androidBannerId: '',
    androidInterstitialId: '',
    iosBannerId: '',
    iosInterstitialId: '',
  },

  // Required on the paywall by Apple for subscriptions.
  legal: {
    privacyUrl: '',
    termsUrl: 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
  },
};
