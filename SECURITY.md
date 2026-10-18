# Security policy

Report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab
(or email the maintainer). Please do not open a public issue. Expect a first reply within a few days.

Scope notes: the API and UI bind to `127.0.0.1` only, data lives in `~/Lemma/`, and provider API keys are
stored in the macOS Keychain. Reports about any of these guarantees being broken are especially welcome.

The Code section compiles and runs Java you write, and Java and Python that a model writes to build tests, directly on your Mac with your user's permissions. Treat a generated problem like code from a stranger you chose to trust: it runs in a scratch directory with time limits, but it is not sandboxed.
