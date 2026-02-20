# Starkmoat Web App

Frontend demo for Starkmoat anonymous-account flows on Starknet Sepolia.

## Run

```bash
cd apps/web
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

## Sepolia Presets

The `Submit Preset Invoke` flow uses ABI-backed templates:

- `StarkmoatRegistry.set_root`
- `StarkmoatSignal.signal`

Addresses auto-load from the repository deployment artifact:

- `deployments/sepolia.json` (source of truth)
- auto-synced to `apps/web/public/deployments/sepolia.json` via `npm run sync:deployments`

Update addresses in `deployments/sepolia.json` after every deployment.

Optional override (only if needed):

```bash
VITE_STARKMOAT_REGISTRY_ADDRESS=0x...
VITE_STARKMOAT_SIGNAL_ADDRESS=0x...
```

Put overrides in `apps/web/.env.local` and restart Vite.

## Where Deployed Addresses Come From

You can get Starkmoat contract addresses from:

1. Deployment command output (`sncast` / deployment script prints the contract address after deploy).
2. Starkscan by opening the deploy transaction and copying the `Contract Address`.
3. Project deployment artifact file: `deployments/sepolia.json` (recommended source of truth).

## Wallet

The app uses:

- `@starknet-io/get-starknet` for wallet discovery/connect modal
- Wallet API methods (`wallet_requestAccounts`, `wallet_requestChainId`, `wallet_addInvokeTransaction`) for browser-safe connect/invoke without RPC CORS issues during connect.

## Connect Troubleshooting

If connect still fails:

1. Open only one Starknet wallet extension at a time (ArgentX or Braavos).
2. Check the status line in the app for the exact wallet error text.
3. Ignore unrelated console logs from non-Starknet extensions (Phantom/Tron/Ton).
