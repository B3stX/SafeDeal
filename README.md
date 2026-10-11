# SafeDeal

Trustless escrow protocol for student micro-freelance on Solana.

## Live on devnet
**Site:** http://noahai-6ab6b4b88d8c9e9bc69f3f4f.netlify.app

## What it does
- Client creates a deal → funds locked in PDA escrow
- Worker claims from open marketplace
- Worker submits work → cancel blocked (worker protection)
- Client approves → funds release: 98% worker, 2% treasury
- Supports SOL + USDC with live Pyth pricing

## 🛠 Tech Stack
- **Smart contracts:** Anchor (Rust), Solana devnet
- **Frontend:** React + TypeScript
- **Wallet:** Phantom (desktop + mobile in-app browser)
- **Oracles:** Pyth price feeds
- **Hosting:** Netlify

## Tests
24/24 passing (generated and run via Noah platform)

## Mobile UX
Works inside Phantom's in-app browser — mobile-first by design.

## Built during
Colosseum Crypto World's Fair hackathon, solo developer.
