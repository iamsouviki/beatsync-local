# Security

This project is an experimental trusted-LAN application, not a hardened public service. Do not port-forward it to the internet. Use trusted HTTPS if native PCM audio or signaling needs transport encryption. Native capture requires explicit OS permission. Guests should know that room codes permit joining and a member can become the sender when a room is idle.

Never commit `.env`, `.certs/`, `.native/`, `.logs/`, signing keys, provisioning profiles, generated apps, or local diagnostics. Build artifacts and development signing material must remain private.

Do not post credentials or private audio in public issues. Report suspected vulnerabilities through the repository's private vulnerability reporting feature if enabled; otherwise ask the maintainer for a private contact without disclosing exploit details publicly.
