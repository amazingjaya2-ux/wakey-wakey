# MileMoney: gig driver earnings and mileage tracker

A phone-first web app (PWA) for DoorDash, Uber Eats, Instacart, Grubhub, Amazon Flex, Spark, Uber/Lyft and other gig drivers.

## Features
- **GPS mileage tracker**: tap Start shift and it counts miles; tap End shift and it pre-fills hours and miles.
- **Dashboard** for today, this week, last week, this month, this year or all time:
  earnings, money left after expenses and tax set-aside, hours, miles, $/hour, $/mile, miles/hour, miles per $,
  orders, $/order, tips and tip share, estimated driving cost, real $/hour after costs, and an 8-week earnings chart.
- **By-app comparison**: which app pays best per hour and per mile.
- **Taxes**: IRS standard mileage deduction (handles 2026's mid-year rate change), Schedule C net profit,
  self-employment tax, federal and state estimates, quarterly estimated-payment set-asides with due dates, CSV export.
- Data stays on the device, with JSON backup and restore. Works offline and installs to the home screen.

## Run
Serve the folder over HTTPS (or `localhost`), for example `python3 -m http.server`, then open it on a phone and choose "Add to Home Screen".

## Known limitations / next steps
- Browsers pause GPS when the screen locks or the app is in the background. The app keeps the screen awake
  (Wake Lock), but reliable background tracking needs a native wrapper such as Capacitor or React Native.
- Data lives in the browser only. Selling it as a product needs accounts plus cloud sync and a subscription backend.
- Earnings are entered by hand. Pulling them in automatically would need a consented-data provider (an earnings-API aggregator).
