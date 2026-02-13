import { connect, disconnect, type StarknetWindowObject } from '@starknet-io/get-starknet'
import { constants, type Call, WalletAccount } from 'starknet'
import { useRef, useState } from 'react'
import './App.css'

const STARK_FIELD_PRIME = BigInt(
  '0x800000000000011000000000000000000000000000000000000000000000001',
)

const DEFAULT_RPC_URL = 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'

type SignalEvent = {
  action: string
  createdAt: string
  id: string
  nullifier: string
  txHash: string
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
  for (const byte of bytes) value = (value << 8n) + BigInt(byte)
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

function parseCalldataInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function resolveWalletName(wallet: StarknetWindowObject): string {
  const candidate = wallet as StarknetWindowObject & { id?: string; name?: string }
  return candidate.name ?? candidate.id ?? 'Starknet wallet'
}

function getExplorerBase(chainId: string): string {
  if (chainId === constants.StarknetChainId.SN_SEPOLIA) return 'https://sepolia.starkscan.co'
  return 'https://starkscan.co'
}

function App() {
  const [walletAccount, setWalletAccount] = useState<WalletAccount | null>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletChainId, setWalletChainId] = useState('')
  const [walletName, setWalletName] = useState('No wallet')
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC_URL)

  const [root, setRoot] = useState('0x0486f6d4a194f2ac7b6d6056bdb8be5e0e77d9f3723bb0afe0c53cb8da6ef2a')
  const [domain, setDomain] = useState(
    'SN_SEPOLIA|0x0123_starkmoat_account|0x0456_starkmoat_registry',
  )
  const [action, setAction] = useState('signal:privacy-preserving-vote')

  const [targetContract, setTargetContract] = useState('')
  const [entrypoint, setEntrypoint] = useState('signal')
  const [rawCalldata, setRawCalldata] = useState('')
  const [appendNullifier, setAppendNullifier] = useState(true)

  const [secret, setSecret] = useState('')
  const [leaf, setLeaf] = useState('')
  const [status, setStatus] = useState('Ready')
  const [isWorking, setIsWorking] = useState(false)
  const [signalCount, setSignalCount] = useState(0)
  const [lastTxHash, setLastTxHash] = useState('')
  const [signals, setSignals] = useState<SignalEvent[]>([])

  const usedNullifiersRef = useRef<Set<string>>(new Set())

  async function onConnectWallet() {
    setIsWorking(true)
    setStatus('Opening wallet selector...')

    try {
      const wallet = await connect({ modalMode: 'alwaysAsk', modalTheme: 'dark' })

      if (!wallet) {
        setStatus('Wallet connection canceled.')
        return
      }

      const account = await WalletAccount.connect({ nodeUrl: rpcUrl }, wallet)
      const chainId = await account.getChainId()

      setWalletAccount(account)
      setWalletAddress(account.address)
      setWalletChainId(chainId)
      setWalletName(resolveWalletName(wallet))

      if (!targetContract) setTargetContract(account.address)
      setStatus(`Wallet connected: ${shortHex(account.address)}`)
    } catch {
      setStatus('Wallet connection failed. Check wallet extension + RPC URL.')
    } finally {
      setIsWorking(false)
    }
  }

  async function onDisconnectWallet() {
    setIsWorking(true)
    try {
      await disconnect()
    } catch {
      // Ignore disconnect transport errors and clear local session anyway.
    } finally {
      setWalletAccount(null)
      setWalletAddress('')
      setWalletChainId('')
      setWalletName('No wallet')
      setIsWorking(false)
      setStatus('Wallet disconnected from UI session.')
    }
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
    if (!walletAccount || !walletAddress) {
      setStatus('Connect a Starknet wallet before submitting an action.')
      return
    }

    if (!secret || !leaf) {
      setStatus('Generate a secret and leaf before sending an anonymous action.')
      return
    }

    if (!targetContract || !entrypoint) {
      setStatus('Provide target contract + entrypoint for invoke.')
      return
    }

    setIsWorking(true)
    setStatus('Building nullifier and submitting invoke transaction...')

    try {
      const actionHash = await hashToFelt([domain, action, root, walletAddress])
      const nullifier = await hashToFelt([secret, actionHash])

      if (usedNullifiersRef.current.has(nullifier)) {
        setStatus(`Replay blocked. Nullifier already used: ${shortHex(nullifier)}`)
        return
      }

      const calldata = parseCalldataInput(rawCalldata)
      const finalCalldata = appendNullifier ? [...calldata, nullifier] : calldata
      const call: Call = {
        calldata: finalCalldata,
        contractAddress: targetContract,
        entrypoint,
      }

      const tx = await walletAccount.execute(call)
      const txHash = tx.transaction_hash

      usedNullifiersRef.current.add(nullifier)
      setSignalCount((count) => count + 1)
      setLastTxHash(txHash)
      setSignals((prev) => [
        {
          action,
          createdAt: new Date().toLocaleTimeString(),
          id: crypto.randomUUID(),
          nullifier,
          txHash,
        },
        ...prev,
      ])
      setStatus(`Invoke submitted: ${shortHex(txHash)}`)
    } catch {
      setStatus('Transaction failed or was rejected by wallet/account.')
    } finally {
      setIsWorking(false)
    }
  }

  const explorerBase = getExplorerBase(walletChainId)
  const txLink = lastTxHash ? `${explorerBase}/tx/${lastTxHash}` : ''
  const walletConnected = walletAccount !== null

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
          <label>
            Starknet RPC URL
            <input value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} />
          </label>
          {walletConnected ? (
            <button disabled={isWorking} onClick={() => void onDisconnectWallet()}>
              Disconnect Wallet
            </button>
          ) : (
            <button disabled={isWorking} onClick={() => void onConnectWallet()}>
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
          <h2>Registry + Domain</h2>
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
          <button disabled={isWorking} onClick={() => void onGenerateSecretAndLeaf()}>
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
          <h2>Invoke Configuration</h2>
          <label>
            Target Contract
            <input value={targetContract} onChange={(event) => setTargetContract(event.target.value)} />
          </label>
          <label>
            Entrypoint
            <input value={entrypoint} onChange={(event) => setEntrypoint(event.target.value)} />
          </label>
          <label>
            Calldata (comma/newline separated felts)
            <input value={rawCalldata} onChange={(event) => setRawCalldata(event.target.value)} />
          </label>
          <label className="checkbox-row">
            <input
              checked={appendNullifier}
              onChange={(event) => setAppendNullifier(event.target.checked)}
              type="checkbox"
            />
            <span>Append nullifier as last calldata item</span>
          </label>
          <label>
            Action Label / tx intent
            <input value={action} onChange={(event) => setAction(event.target.value)} />
          </label>
          <button disabled={isWorking} onClick={() => void onAnonymousAction()}>
            Submit Invoke
          </button>
          <p className="meta">Signals accepted: {signalCount}</p>
          <p className="status">{status}</p>
          {txLink && (
            <a className="tx-link" href={txLink} rel="noreferrer" target="_blank">
              View last tx on Starkscan
            </a>
          )}
        </article>
      </section>

      <section className="panel reveal delay-5">
        <h2>Recent Signals</h2>
        {signals.length === 0 ? (
          <p className="meta">No anonymous invoke submissions yet.</p>
        ) : (
          <ul className="signal-list">
            {signals.map((item) => (
              <li key={item.id}>
                <span>{item.createdAt}</span>
                <strong>{item.action}</strong>
                <code>{shortHex(item.nullifier)}</code>
                <a href={`${explorerBase}/tx/${item.txHash}`} rel="noreferrer" target="_blank">
                  {shortHex(item.txHash)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="footnote">
        This version sends a real Starknet invoke via `starknet.js` WalletAccount. For demo flow,
        pass nullifier to your contract and enforce replay protection on-chain.
      </div>
    </main>
  )
}

export default App
