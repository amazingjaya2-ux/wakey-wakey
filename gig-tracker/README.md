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
- **Black and white glass design**: follows the phone's light or dark mode, with spring animations, a sliding tab bar,
  bottom sheets you can swipe down, and haptic taps on phones.

## Project layout
| Path | What it is |
|---|---|
| `www/` | The app (HTML/CSS/JS). `store.js` = data and tax math, `sync.js` = accounts and sync, `app.js` = screens |
| `www/config.js` | Your Supabase project URL and public key (see below) |
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
- Both stores require a **privacy policy URL**. It should say that the app stores email, shifts and expenses in Supabase,
  and that location is used on the phone to count miles and isn't uploaded.

## Ideas for later
- Paid subscriptions (for example with RevenueCat, which handles both stores).
- Sign in with Apple and Google.
- Automatic earnings import through a consented earnings-data provider.
- Receipt photos attached to expenses.
