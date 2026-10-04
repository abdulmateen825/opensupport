# Security policy

Do not post credentials, customer records, or exploit details in public issues. Report vulnerabilities through the repository's private vulnerability reporting feature when enabled, or contact a maintainer privately through their GitHub profile. Include the affected revision, reproduction steps, impact, and a suggested fix when available. There is no guaranteed response SLA.

Only the current main branch is maintained. Use a tested revision and locked dependencies, apply security updates, and review provider plugins before installing them. Never include `.env`, database exports, or live tokens in a pull request.

Production operators must use HTTPS, separate strong secrets, private infrastructure services, project origin validation, tenant-scoped authorization, and tested backups. Widget feature callbacks are capabilities supplied by the website; they do not replace server-side authorization or signed customer identity. Cart, price, stock, and order ownership must be verified on the integrating store's backend.

Current boundaries: the dashboard keeps bearer tokens in local storage; the WebSocket hub is in-process; demo purchases are local fictional data. See the [production guide](docs/PRODUCTION_DEPLOYMENT.md) for operational limitations. This repository has not undergone an independent security audit.
