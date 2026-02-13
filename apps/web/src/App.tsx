import { useRef, useState } from 'react'
import './App.css'

const STARK_FIELD_PRIME = BigInt(
  '0x800000000000011000000000000000000000000000000000000000000000001',
)

type SignalEvent = {
  id: string
  action: string
  nullifier: string
  createdAt: string
}

type InjectedStarknetWallet = {
  account?: { address?: string }
  chainId?: string
  enable?: (options?: { showModal?: boolean }) => Promise<string[] | undefined>
  id?: string
  isConnected?: boolean
  name?: string
  request?: (options: { params?: unknown; type: string }) => Promise<unknown>
  selectedAddress?: string
}

declare global {
  interface Window {
    starknet?: InjectedStarknetWallet
  }
}

function toHexFelt(value: bigint): string {
  return `0x${value.toString(16)}`
}

function shortHex(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte)
  }
  return value
}

async function hashToFelt(parts: string[]): Promise<string> {
  const encoded = new TextEncoder().encode(parts.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const felt = bytesToBigInt(new Uint8Array(digest)) % STARK_FIELD_PRIME
  return toHexFelt(felt)
}

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const felt = bytesToBigInt(bytes) % STARK_FIELD_PRIME
  return toHexFelt(felt)
}

function resolveWalletAddress(wallet: InjectedStarknetWallet, accounts?: string[]): string {
  if (wallet.selectedAddress) return wallet.selectedAddress
  if (wallet.account?.address) return wallet.account.address
  if (accounts && accounts.length > 0) return accounts[0]
  return ''
}

function App() {
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletChainId, setWalletChainId] = useState('')
  const [walletName, setWalletName] = useState('No wallet')
  const [root, setRoot] = useState('0x0486f6d4a194f2ac7b6d6056bdb8be5e0e77d9f3723bb0afe0c53cb8da6ef2a')
  const [domain, setDomain] = useState(
    'SN_SEPOLIA|0x0123_starkmoat_account|0x0456_starkmoat_registry',
  )
  const [action, setAction] = useState('signal:privacy-preserving-vote')
  const [secret, setSecret] = useState('')
  const [leaf, setLeaf] = useState('')
  const [status, setStatus] = useState('Ready')
  const [isWorking, setIsWorking] = useState(false)
  const [signalCount, setSignalCount] = useState(0)
  const [signals, setSignals] = useState<SignalEvent[]>([])
  const usedNullifiersRef = useRef<Set<string>>(new Set())

  async function onConnectWallet() {
    const wallet = window.starknet

    if (!wallet) {
      setStatus('No Starknet wallet detected. Install Argent X or Braavos and refresh.')
      return
    }

    setIsWorking(true)
    setStatus('Connecting Starknet wallet...')

    try {
      let accounts: string[] | undefined

      if (wallet.enable) {
        accounts = await wallet.enable({ showModal: true })
      } else if (wallet.request) {
        const response = await wallet.request({ type: 'wallet_requestAccounts' })
        if (Array.isArray(response)) {
          accounts = response.filter((item): item is string => typeof item === 'string')
        }
      }

      const address = resolveWalletAddress(wallet, accounts)

      if (!address) {
        setStatus('Wallet connected but no Starknet account was exposed.')
        return
      }

      setWalletConnected(true)
      setWalletAddress(address)
      setWalletChainId(wallet.chainId ?? 'unknown')
      setWalletName(wallet.name ?? wallet.id ?? 'Injected wallet')
      setStatus(`Wallet connected: ${shortHex(address)}`)
    } catch {
      setStatus('Wallet connection failed. Confirm the wallet popup and retry.')
    } finally {
      setIsWorking(false)
    }
  }

  function onDisconnectWallet() {
    setWalletConnected(false)
    setWalletAddress('')
    setWalletChainId('')
    setWalletName('No wallet')
    setStatus('Wallet disconnected from UI session.')
  }

  async function onGenerateSecretAndLeaf() {
    setIsWorking(true)
    setStatus('Generating member secret and leaf...')
    try {
      const nextSecret = generateSecret()
      const nextLeaf = await hashToFelt([nextSecret])
      setSecret(nextSecret)
      setLeaf(nextLeaf)
      setStatus('Secret and leaf generated. Share only the leaf for enrollment.')
    } catch {
      setStatus('Failed to generate secret/leaf in this browser.')
    } finally {
      setIsWorking(false)
    }
  }

  async function onAnonymousAction() {
    if (!walletConnected || !walletAddress) {
      setStatus('Connect a Starknet wallet before sending an anonymous action.')
      return
    }

    if (!secret || !leaf) {
      setStatus('Generate a secret and leaf before sending an anonymous action.')
      return
    }

    setIsWorking(true)
    setStatus('Building action binding + nullifier...')
    try {
      const actionHash = await hashToFelt([domain, action, root, walletAddress])
      const nullifier = await hashToFelt([secret, actionHash])

      if (usedNullifiersRef.current.has(nullifier)) {
        setStatus(`Replay blocked. Nullifier already used: ${shortHex(nullifier)}`)
        return
      }

      usedNullifiersRef.current.add(nullifier)
      setSignalCount((count) => count + 1)
      setSignals((prev) => [
        {
          id: crypto.randomUUID(),
          action,
          nullifier,
          createdAt: new Date().toLocaleTimeString(),
        },
        ...prev,
      ])

      setStatus(`Anonymous action accepted. Nullifier: ${shortHex(nullifier)}`)
    } catch {
      setStatus('Action failed while creating demo proof inputs.')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <main className="page">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <section className="hero reveal">
        <p className="eyebrow">Starknet Zero-Knowledge Account Abstraction</p>
        <h1>Starkmoat</h1>
        <p className="hero-copy">
          Authorize account actions with a proof of membership instead of a wallet signature.
          Validators see that someone in the group approved the action, not who.
        </p>
      </section>

      <section className="panel-grid">
        <article className="panel reveal delay-1">
          <h2>Wallet</h2>
          <p className="meta">
            {walletConnected ? `Connected to ${walletName}` : 'Connect an injected Starknet wallet'}
          </p>
          {walletConnected ? (
            <button disabled={isWorking} onClick={onDisconnectWallet}>
              Disconnect Wallet
            </button>
          ) : (
            <button disabled={isWorking} onClick={onConnectWallet}>
              Connect Wallet
            </button>
          )}
          <div className="field">
            <span>Account</span>
            <code>{walletAddress || 'not connected'}</code>
          </div>
          <div className="field">
            <span>Chain ID</span>
            <code>{walletChainId || 'not connected'}</code>
          </div>
        </article>

        <article className="panel reveal delay-2">
          <h2>Registry Root</h2>
          <label>
            Current Merkle Root
            <input value={root} onChange={(event) => setRoot(event.target.value)} />
          </label>
          <label>
            Domain Separator
            <input value={domain} onChange={(event) => setDomain(event.target.value)} />
          </label>
        </article>

        <article className="panel reveal delay-3">
          <h2>Member Setup</h2>
          <button disabled={isWorking} onClick={onGenerateSecretAndLeaf}>
            Generate Secret + Leaf
          </button>
          <div className="field">
            <span>Secret (private)</span>
            <code>{secret || 'not generated'}</code>
          </div>
          <div className="field">
            <span>Leaf (share for Merkle tree)</span>
            <code>{leaf || 'not generated'}</code>
          </div>
        </article>

        <article className="panel reveal delay-4">
          <h2>Anonymous Action</h2>
          <label>
            Action Label / tx intent
            <input value={action} onChange={(event) => setAction(event.target.value)} />
          </label>
          <button disabled={isWorking} onClick={onAnonymousAction}>
            Send Anonymous Signal
          </button>
          <p className="meta">Signals accepted: {signalCount}</p>
          <p className="status">{status}</p>
        </article>
      </section>

      <section className="panel reveal delay-5">
        <h2>Recent Signals</h2>
        {signals.length === 0 ? (
          <p className="meta">No anonymous signals yet.</p>
        ) : (
          <ul className="signal-list">
            {signals.map((item) => (
              <li key={item.id}>
                <span>{item.createdAt}</span>
                <strong>{item.action}</strong>
                <code>{shortHex(item.nullifier)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="footnote">
        Demo mode: proof generation and on-chain submission are represented by deterministic browser
        hashing so flow state is visible before contract/verifier wiring is added.
      </div>
    </main>
  )
}

export default App
