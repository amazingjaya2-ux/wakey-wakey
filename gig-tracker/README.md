# MileMoney: gig driver earnings, mileage and tax tracker

A phone app for DoorDash, Uber Eats, Instacart, Grubhub, Amazon Flex, Spark, Uber/Lyft and other gig drivers.
Built with [Capacitor](https://capacitorjs.com), so the same code ships as an **Android app**, an **iPhone app** and a web app.

## Features
- **GPS mileage tracker that keeps running in the background.** Start a shift, switch to DoorDash, lock the phone.
  When you end the shift, it pre-fills the hours and miles.
- **Overview** for today, this week, this month, this year or all time: earnings, take-home after expenses and taxes,
  hours, miles, orders, $/hour, $/mile, $/order, miles/hour, miles/order, **miles per gallon** (from your gas fill-ups),
  tips, expenses and real $/hour after driving costs, plus an 8-week chart and a by-app comparison.
- **Tax-deductible expenses**: gas, oil changes, tires, repairs, car wash, insurance, registration, lease, car loan
  interest, tolls, parking, phone and data plan (business-use %), phone mounts and chargers, delivery bags, water and
  snacks for riders, apps and tax software, cash-out fees and more. Your own food is logged too, but marked as not
  deductible.
- **Taxes tab** follows the IRS rules: it compares the **standard mileage** and **actual expense** methods and tells you
  which one deducts more. It also estimates self-employment, federal and state tax, shows quarterly set-asides, and
  exports a CSV for a tax preparer.
- **Accounts and cloud sync** (email and password). Works offline, syncs when online, and works across phones.
  Includes in-app account deletion, which both app stores require.
- **Free with ads, or Pro without them.** Free users see a small banner above the tab bar and, at most every
  10 minutes, a full-screen ad after every 4th save (never during a shift). **MileMoney Pro** (monthly or yearly,
  optional free trial) removes every ad. Purchases follow the user's account to their other phones, and there's
  Restore purchases, Manage subscription, Google's EU/UK consent form and Apple's tracking prompt.
- **Black and white glass design**: follows the phone's light or dark mode, with spring animations, a sliding tab bar,
  bottom sheets you can swipe down, and haptic taps on phones.

## Project layout
| Path | What it is |
|---|---|
| `www/` | The app (HTML/CSS/JS). `store.js` = data and tax math, `sync.js` = accounts and sync, `app.js` = screens |
| `www/config.js` | Public keys for Supabase, RevenueCat and AdMob, plus your privacy/terms links |
| `www/monetize.js` | Subscriptions (RevenueCat) and ads (AdMob) |
| `supabase/schema.sql` | Database table, security rules and account deletion. Run it once in Supabase |
| `android/`, `ios/` | Native projects (Android Studio / Xcode) |
| `assets/` | Source icon and splash images (`npm run assets` regenerates every size) |

## Turn on accounts and cloud sync (about 10 minutes)
1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste all of `supabase/schema.sql` and press **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `www/config.js`.
   The anon key is safe to ship in the app: the row-level security rules in the schema keep each user's data private.
4. In **Authentication → Sign In / Providers → Email**, choose whether new users must confirm their email.
   If confirmation stays on, set **Authentication → URL Configuration → Site URL** to a page you control
   (for example your website), because that is where the confirmation link sends people.
5. Run `npm run sync` and rebuild the app.

Without step 3 the app runs in local-only mode: everything works, but there are no accounts.

## Turn on subscriptions (RevenueCat)
RevenueCat handles App Store and Google Play billing, receipts and renewals. It's free until about $2,500 a month in revenue.
1. In **App Store Connect** and the **Google Play Console**, create auto-renewing subscriptions, for example
   `pro_monthly` ($4.99) and `pro_yearly` ($39.99, optionally with a 1-week free trial).
   Google Play only lets you create subscriptions after you upload a first build (the debug APK isn't enough:
   upload a signed bundle to the Internal testing track).
2. Create a project at [revenuecat.com](https://www.revenuecat.com) and add an iOS app and an Android app
   (it walks you through connecting each store).
3. **Product catalog → Entitlements**: create one called `pro` and attach both products.
4. **Product catalog → Offerings**: make the `default` offering current, with a Monthly and an Annual package.
5. Copy the public **Apple** (`appl_…`) and **Google** (`goog_…`) API keys into `revenueCat` in `www/config.js`.
6. Test with a sandbox Apple account and a Google Play license tester. Purchases in testing are never charged.

The paywall's yearly "Save %" badge and the "Start free trial" button come straight from the store prices.

## Turn on ads (Google AdMob)
1. Create an account at [admob.google.com](https://admob.google.com) and add the Android and iOS apps.
2. Replace Google's **test app IDs** with your real app IDs in `android/app/src/main/AndroidManifest.xml`
   (`com.google.android.gms.ads.APPLICATION_ID`) and `ios/App/App/Info.plist` (`GADApplicationIdentifier`).
3. Create a **Banner** and an **Interstitial** ad unit for each platform and paste their IDs into `admob` in `www/config.js`.
4. In AdMob, open **Privacy & messaging** and create a **GDPR** message (and the **IDFA** message for iOS). The app
   shows these automatically where the law requires them. Settings → "Ad privacy choices" lets users change them.
5. Keep `useTestAds: true` while developing. **Never tap your own real ads**, because AdMob bans accounts for that.
   Set it to `false` only in the build you publish.
6. Add an `app-ads.txt` file to your website (AdMob shows you the line to put in it).

## Get the Android app without installing anything
Every push to GitHub builds a test APK. Open **Actions → Build Android app**, pick the latest run, and download
**MileMoney-debug-apk**. Copy it to an Android phone and open it.

## Develop
```sh
npm install          # also copies Capacitor and Supabase browser builds into www/vendor
npm run serve        # try it in a browser at http://localhost:8080
npm run android      # sync and open Android Studio (then press Run)
npm run ios          # sync and open Xcode (macOS only, then press Run)
```
After editing anything in `www/`, run `npm run sync` to copy it into the native projects.

## Publishing checklist
- **Google Play** ($25 one time): Build → Generate Signed App Bundle in Android Studio. Keep the signing key safe.
  Declare background location (shift mileage tracking) and the location foreground service in the Play Console.
- **Apple App Store** ($99/year, needs a Mac): set your Team in Xcode, then Product → Archive. Explain the "Always"
  location permission in App Review (it tracks business miles during a shift).
- Choose the final app ID (`appId` in `capacitor.config.json`, the Android `applicationId` and the iOS bundle ID)
  before the first release. It can't change afterwards.
- Both stores require a **privacy policy URL** (put it in `legal.privacyUrl` too, because the paywall links to it). It should say
  that the app stores email, shifts and expenses in Supabase, that location is used on the phone to count miles and
  isn't uploaded, and that free users see ads from Google AdMob, which may use the device's advertising ID.
- In the Play Console, answer **"Contains ads: Yes"**, and in the Data safety form declare the advertising ID and
  purchase history. In App Store Connect, the privacy "nutrition label" needs the same (Identifiers, Purchases, Usage data).

## Ideas for later
- Extra Pro-only features (receipt photos, PDF tax reports) to make the subscription more attractive.
- Sign in with Apple and Google.
- Automatic earnings import through a consented earnings-data provider.
- Receipt photos attached to expenses.
