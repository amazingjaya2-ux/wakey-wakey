# MileMoney: gig driver earnings and mileage tracker

A phone app for DoorDash, Uber Eats, Instacart, Grubhub, Amazon Flex, Spark, Uber/Lyft and other gig drivers.
Built with [Capacitor](https://capacitorjs.com), so the same code ships as an **Android app**, an **iPhone app** and a web app.

## Features
- **GPS mileage tracker that keeps running in the background.** Tap Start shift, switch to DoorDash, lock the phone,
  and it keeps counting. Android shows a "tracking your miles" notification, and iOS uses background location.
  When you tap End shift, it pre-fills the hours and miles for that shift.
- **Dashboard** for today, this week, last week, this month, this year or all time:
  earnings, money left after expenses and tax set-aside, hours, miles, $/hour, $/mile, miles/hour, miles per $,
  orders, $/order, tips and tip share, driving cost, real $/hour after costs, and an 8-week chart.
- **By-app comparison**: which app pays best per hour and per mile.
- **Taxes**: IRS mileage deduction (handles 2026's mid-year rate change), Schedule C profit, self-employment tax,
  federal and state estimates, quarterly payment set-asides, and CSV export through the phone's share sheet.
- Data is stored on the device in native storage, with JSON backup and restore.

## Project layout
| Path | What it is |
|---|---|
| `www/` | The app itself (HTML/CSS/JS). Edit this. |
| `android/` | Native Android project (open in Android Studio) |
| `ios/` | Native iOS project (open in Xcode, macOS only) |
| `assets/` | Source icon and splash images; `npm run assets` regenerates every native size |
| `capacitor.config.json` | App id (`com.milemoney.app`), name, and plugin settings |

## Get the Android app without installing anything
Every push to GitHub builds a test APK. In the repo, open **Actions → Build Android app**, choose the latest run, and
download **MileMoney-debug-apk**. Copy the APK to an Android phone, open it, and allow "install unknown apps".

## Develop
```sh
npm install          # also copies Capacitor's runtime into www/
npm run serve        # try it in a browser at http://localhost:8080
npm run android      # sync and open Android Studio (then press Run)
npm run ios          # sync and open Xcode (macOS only, then press Run)
```
After editing anything in `www/`, run `npm run sync` to copy it into the native projects.

## Publishing
- **Google Play**: needs a Google Play developer account ($25 one-time). In Android Studio, use Build → Generate Signed
  App Bundle. Keep the signing key safe, because you need it for every future update. In the Play Console,
  declare the background location use (shift mileage tracking) and the location foreground service.
- **Apple App Store**: needs a Mac with Xcode and an Apple Developer account ($99/year). Set your Team under
  Signing & Capabilities, then Product → Archive. App Review will ask why you use "Always" location, so explain
  that it tracks business miles during a shift.
- Pick your final **app id** before the first release (`appId` in `capacitor.config.json`, plus the Android
  `applicationId` and the iOS bundle id). It can't change after publishing.
- Both stores require a **privacy policy URL**. Location data never leaves the phone today, which keeps that simple.

## Next steps for a paid product
- Accounts and cloud sync, so data survives a lost phone and works across devices.
- Subscriptions, for example through RevenueCat, which handles both stores.
- Automatic earnings import through a consented earnings-data provider.
