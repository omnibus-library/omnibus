# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes. Please update to the
current release before reporting.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/omnibus-library/omnibus/security/advisories/new)
to report security issues confidentially. **Do not open a public issue for a
security vulnerability.**

What to expect:

- Acknowledgement within 3 business days.
- A status update within 14 days.
- Up to 90 days for investigation, remediation, and coordinated disclosure
  before details are published. Critical vulnerabilities that put users at
  active risk may be disclosed and fixed sooner.

## Scope

Omnibus is a self-hosted server with a web frontend, a native iOS client, an
Android shell, and an MCP server. Anything that lets a user read or modify
another user's data, escalate privileges, or execute code on the server is in
scope. Issues that require an attacker to already hold admin credentials are
generally out of scope, but report them anyway if you're unsure.
