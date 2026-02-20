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

To make these one-click against your deployed contracts, set:

```bash
VITE_STARKMOAT_REGISTRY_ADDRESS=0x...
VITE_STARKMOAT_SIGNAL_ADDRESS=0x...
```

Create `apps/web/.env.local` with those values, then restart Vite.

## Wallet

The app uses:

- `@starknet-io/get-starknet` for wallet discovery/connect modal
- `starknet.js` `WalletAccount` for real `execute(...)` invoke submission
