## About

CSIT321 Final Year Project, University of Wollongong (UOW). Group FYP-26-S3-14.

BioAudit is a university project, and the website is for demonstration purposes only.

# BioAudit Website

The website for **BioAudit**, an Android biometric authentication security testing tool. Students and organisations sign up here, manage their account on a dashboard, and download the BioAudit desktop app.

**Live site:** https://bioaudit.me

## What the site does

- **Plans page:** compares the free Student plan and the paid Organisation plan.
- **Student signup:** free. A student picks their university and enters a university email address. We email a six-digit code to confirm the address exists and belongs to that university before the account is created.
- **Organisation signup:** paid through Stripe Checkout. Only admins purchase for the organisation; members join through an invite in the app.
- **Login and dashboard:** sign in (with password reset by email code), see your plan and time left, download the app and view your scan reports. Organisation admins can see their members' reports and cancel or renew the subscription.
- **Info pages:** home, about, learn more, guide and terms.

## Built with

- HTML, CSS and plain JavaScript (no build step)
- Firebase Hosting, Authentication and Firestore
- Firebase Cloud Functions (Node 22)
- Stripe Checkout for organisation payments
- The BioAudit backend (Node/Express on Google Cloud Run) for student verification and account creation

## Project structure

```
public/      The website pages, scripts, styles and images
functions/   Cloud Functions (links an account to its organisation after a Stripe payment)
firebase.json   Firebase Hosting and Functions configuration
```

## Deploying

The site is served by Firebase Hosting, which uploads the local `public/` folder. After committing and pushing changes, run:

```
firebase deploy --only hosting
```

Use `firebase deploy --only functions` when `functions/` changes.

## Related repository

The BioAudit app and backend live in a separate repository:
[FYP-UOW-2026/Final_Year_Project](https://github.com/FYP-UOW-2026/Final_Year_Project)


