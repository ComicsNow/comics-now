# Security Policy

## Supported versions

Security fixes are applied to the latest released version of Comics Now!.
Please make sure you are running the most recent release before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [private vulnerability reporting](https://github.com/ComicsNow/comics-now/security/advisories/new)
(Security → Advisories → "Report a vulnerability"). If that is unavailable,
email the maintainer at comicsnowdev@gmail.com.

Please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof of concept is ideal)
- The affected version or commit

You can expect an initial acknowledgement within a few days. Once a fix is
released, we are happy to credit reporters who wish to be named.

## Scope

Comics Now! is typically deployed behind Cloudflare Access (or another
authenticating reverse proxy). When assessing impact, note that the
`authentication.trustedIPs` bypass is intended only for requests that reach the
app **directly** from a trusted address; requests carrying forwarding headers
(`X-Forwarded-For`, `Forwarded`, `Cf-Connecting-Ip`) never receive it.
