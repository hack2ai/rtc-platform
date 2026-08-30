# Security Policy

## Supported versions

RTC Platform is currently under active development. Security fixes should target the latest `main` branch unless a release branch is explicitly announced.

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public GitHub issue.

Use GitHub's private vulnerability reporting feature for this repository, or contact the repository maintainers privately through the contact method configured on the GitHub profile.

Include:

- a clear description of the vulnerability;
- affected component(s) and file/path when known;
- reproduction steps or a minimal proof of concept;
- impact and realistic attack prerequisites;
- any suggested mitigation.

Do not include real credentials, private meeting content, personal data, or production tokens in a report.

## Security-sensitive areas

Extra care is required for changes involving Firebase Authentication, Firestore/Storage rules, CORS, authorization middleware, file uploads, meeting access control, WebRTC signaling, and TURN credentials.

## Secrets

Never commit Firebase Admin service-account credentials, private keys, API tokens, TURN credentials, `.env` runtime files, or other deployment secrets.
