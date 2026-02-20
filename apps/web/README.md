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

## Where Deployed Addresses Come From

You can get Starkmoat contract addresses from:

1. Deployment command output (`sncast` / deployment script prints the contract address after deploy).
2. Starkscan by opening the deploy transaction and copying the `Contract Address`.
3. Project deployment artifact file (recommended): commit addresses to something like
   `deployments/sepolia.json` and use it as the source of truth.

For this frontend, copy the final addresses into `apps/web/.env.local`:

```bash
VITE_STARKMOAT_REGISTRY_ADDRESS=0x...
VITE_STARKMOAT_SIGNAL_ADDRESS=0x...
```

## Wallet

The app uses:

- `@starknet-io/get-starknet` for wallet discovery/connect modal
- `starknet.js` `WalletAccount` for real `execute(...)` invoke submission
