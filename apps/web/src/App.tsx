import { connect, disconnect, type StarknetWindowObject } from '@starknet-io/get-starknet'
import { CallData, constants, Provider, type Abi, type Call, WalletAccount, WalletAccountV5 } from 'starknet'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const STARK_FIELD_PRIME = BigInt(
  '0x800000000000011000000000000000000000000000000000000000000000001',
)
const DEFAULT_RPC_URL = 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'
const DEPLOYMENT_ARTIFACT_URL = '/deployments/sepolia.json'

const REGISTRY_PRESET_ADDRESS =
  (import.meta.env.VITE_STARKMOAT_REGISTRY_ADDRESS as string | undefined) ?? ''
const SIGNAL_PRESET_ADDRESS =
  (import.meta.env.VITE_STARKMOAT_SIGNAL_ADDRESS as string | undefined) ?? ''

type SignalEvent = {
  action: string
  createdAt: string
  id: string
  nullifier: string
  txHash: string
}

type ConnectedWalletAccount = WalletAccount | WalletAccountV5

declare global {
  interface Window {
    starknet?: StarknetWindowObject
  }
}

type TemplateArgSource = 'input' | 'nullifier' | 'root'

type TemplateArg = {
  label: string
  name: string
  placeholder?: string
  source: TemplateArgSource
}

type InvokeTemplate = {
  abi: Abi
  actionLabel: string
  contractAddress: string
  description: string
  entrypoint: string
  id: string
  name: string
  templateArgs: TemplateArg[]
}

type DeploymentArtifact = {
  chain_id?: string
  contracts?: {
    starkmoat_registry?: { address?: string }
    starkmoat_signal?: { address?: string }
  }
  network?: string
  updated_at?: string
}

const STARKMOAT_REGISTRY_ABI: Abi = [
  {
    inputs: [{ name: 'new_root', type: 'felt252' }],
    name: 'set_root',
    outputs: [],
    state_mutability: 'external',
    type: 'function',
  },
]

const STARKMOAT_SIGNAL_ABI: Abi = [
  {
    inputs: [{ name: 'nullifier', type: 'felt252' }],
    name: 'signal',
    outputs: [],
    state_mutability: 'external',
    type: 'function',
  },
]

function getSepoliaTemplates(registryAddress: string, signalAddress: string): InvokeTemplate[] {
  return [
    {
      abi: STARKMOAT_REGISTRY_ABI,
      actionLabel: 'registry:set_root',
      contractAddress: registryAddress,
      description:
        'Admin demo action to rotate Starkmoat Merkle root on Sepolia. Requires admin wallet.',
      entrypoint: 'set_root',
      id: 'registry_set_root',
      name: 'StarkmoatRegistry.set_root',
      templateArgs: [{ label: 'New Root', name: 'new_root', source: 'root' }],
    },
    {
      abi: STARKMOAT_SIGNAL_ABI,
      actionLabel: 'signal:anonymous-action',
      contractAddress: signalAddress,
      description:
        'One-click anonymous signal template. Compiles ABI calldata and injects derived nullifier.',
      entrypoint: 'signal',
      id: 'signal_nullifier',
      name: 'StarkmoatSignal.signal',
      templateArgs: [{ label: 'Nullifier', name: 'nullifier', source: 'nullifier' }],
    },
  ]
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

function resolveWalletName(wallet: StarknetWindowObject): string {
  const candidate = wallet as StarknetWindowObject & { id?: string; name?: string }
  return candidate.name ?? candidate.id ?? 'Starknet wallet'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'unknown error'
  }
}

function normalizeAddress(address: string | undefined): string {
  if (!address) return ''
  return address.trim()
}

function getExplorerBase(chainId: string): string {
  if (chainId === constants.StarknetChainId.SN_SEPOLIA) return 'https://sepolia.starkscan.co'
  return 'https://starkscan.co'
}

function buildTemplateValues(template: InvokeTemplate, root: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const arg of template.templateArgs) {
    if (arg.source === 'root') values[arg.name] = root
    if (arg.source === 'input') values[arg.name] = ''
  }
  return values
}

function App() {
  const [registryPresetAddress, setRegistryPresetAddress] = useState(REGISTRY_PRESET_ADDRESS)
  const [signalPresetAddress, setSignalPresetAddress] = useState(SIGNAL_PRESET_ADDRESS)
  const [artifactLoaded, setArtifactLoaded] = useState(false)
  const [artifactSourceLabel, setArtifactSourceLabel] = useState('env fallback')

  const templates = useMemo(
    () => getSepoliaTemplates(registryPresetAddress, signalPresetAddress),
    [registryPresetAddress, signalPresetAddress],
  )

  const [walletAccount, setWalletAccount] = useState<ConnectedWalletAccount | null>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletChainId, setWalletChainId] = useState('')
  const [walletName, setWalletName] = useState('No wallet')
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC_URL)

  const [root, setRoot] = useState('0x0486f6d4a194f2ac7b6d6056bdb8be5e0e77d9f3723bb0afe0c53cb8da6ef2a')
  const [domain, setDomain] = useState(
    'SN_SEPOLIA|0x0123_starkmoat_account|0x0456_starkmoat_registry',
  )
  const [action, setAction] = useState('signal:privacy-preserving-vote')

  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? '')
  const [presetContractAddress, setPresetContractAddress] = useState(templates[0]?.contractAddress ?? '')
  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    buildTemplateValues(templates[0], root),
  )

  const [secret, setSecret] = useState('')
  const [leaf, setLeaf] = useState('')
  const [status, setStatus] = useState('Ready')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signalCount, setSignalCount] = useState(0)
  const [lastTxHash, setLastTxHash] = useState('')
  const [signals, setSignals] = useState<SignalEvent[]>([])

  const usedNullifiersRef = useRef<Set<string>>(new Set())
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? templates[0]

  useEffect(() => {
    let isMounted = true

    async function loadDeploymentArtifact() {
      try {
        const response = await fetch(DEPLOYMENT_ARTIFACT_URL, { cache: 'no-store' })
        if (!response.ok) return

        const artifact = (await response.json()) as DeploymentArtifact
        const registryAddress = normalizeAddress(artifact.contracts?.starkmoat_registry?.address)
        const signalAddress = normalizeAddress(artifact.contracts?.starkmoat_signal?.address)

        if (!isMounted) return

        setArtifactLoaded(true)
        setArtifactSourceLabel('deployments/sepolia.json')
        if (registryAddress) setRegistryPresetAddress(registryAddress)
        if (signalAddress) setSignalPresetAddress(signalAddress)
      } catch {
        // Keep env fallback when artifact is not available yet.
      }
    }

    void loadDeploymentArtifact()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!selectedTemplate) return
    setPresetContractAddress(selectedTemplate.contractAddress)
    setTemplateValues(buildTemplateValues(selectedTemplate, root))
    setAction(selectedTemplate.actionLabel)
  }, [selectedTemplate, root])

  async function onConnectWallet() {
    if (isConnecting) return
    setIsConnecting(true)
    setStatus('Opening wallet selector...')

    try {
      const modalWallet = await connect({ modalMode: 'alwaysAsk', modalTheme: 'dark' })
      const wallet = modalWallet ?? window.starknet

      if (!wallet) {
        setStatus('No wallet found. Install/open ArgentX or Braavos, then retry connect.')
        return
      }

      let account: ConnectedWalletAccount
      try {
        account = await WalletAccount.connect({ nodeUrl: rpcUrl }, wallet)
      } catch {
        const provider = new Provider({ nodeUrl: rpcUrl })
        account = await WalletAccountV5.connect(provider, wallet as never)
      }

      // Force account permission sync for wallets that delay account exposure until explicit request.
      await account.requestAccounts(false)
      const chainId = await account.getChainId()

      setWalletAccount(account)
      setWalletAddress(account.address)
      setWalletChainId(chainId)
      setWalletName(resolveWalletName(wallet))
      setStatus(`Wallet connected: ${shortHex(account.address)}`)
    } catch (error) {
      setStatus(`Wallet connection failed: ${getErrorMessage(error)}`)
    } finally {
      setIsConnecting(false)
    }
  }

  async function onDisconnectWallet() {
    if (isConnecting) return
    setIsConnecting(true)
    try {
      await disconnect()
    } catch {
      // Ignore transport cleanup errors and clear local state anyway.
    } finally {
      setWalletAccount(null)
      setWalletAddress('')
      setWalletChainId('')
      setWalletName('No wallet')
      setIsConnecting(false)
      setStatus('Wallet disconnected from UI session.')
    }
  }

  async function onGenerateSecretAndLeaf() {
    setIsGenerating(true)
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
      setIsGenerating(false)
    }
  }

  async function onAnonymousAction() {
    if (!walletAccount || !walletAddress) {
      setStatus('Connect a Starknet wallet before submitting an action.')
      return
    }
    if (!selectedTemplate) {
      setStatus('Choose a call template before submitting.')
      return
    }
    if (!secret || !leaf) {
      setStatus('Generate a secret and leaf before sending an anonymous action.')
      return
    }
    if (!presetContractAddress) {
      setStatus(
        'Preset contract address missing. Update deployments/sepolia.json or enter address in this form.',
      )
      return
    }

    setIsSubmitting(true)
    setStatus('Building ABI calldata and submitting invoke transaction...')

    try {
      const actionHash = await hashToFelt([domain, action, root, walletAddress])
      const nullifier = await hashToFelt([secret, actionHash])

      if (usedNullifiersRef.current.has(nullifier)) {
        setStatus(`Replay blocked. Nullifier already used: ${shortHex(nullifier)}`)
        return
      }

      const callArgs: Record<string, string> = {}
      for (const arg of selectedTemplate.templateArgs) {
        if (arg.source === 'nullifier') {
          callArgs[arg.name] = nullifier
          continue
        }

        const value = (templateValues[arg.name] ?? '').trim()
        if (!value) {
          setStatus(`Missing template input: ${arg.label}`)
          return
        }
        callArgs[arg.name] = value
      }

      const calldata = new CallData(selectedTemplate.abi).compile(selectedTemplate.entrypoint, callArgs)
      const call: Call = {
        calldata,
        contractAddress: presetContractAddress,
        entrypoint: selectedTemplate.entrypoint,
      }

      const tx = await walletAccount.execute(call)
      const txHash = tx.transaction_hash

      usedNullifiersRef.current.add(nullifier)
      setSignalCount((count) => count + 1)
      setLastTxHash(txHash)
      setSignals((prev) => [
        {
          action: selectedTemplate.actionLabel,
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
      setIsSubmitting(false)
    }
  }

  function onWalletPrimaryClick() {
    if (walletAccount) {
      void onDisconnectWallet()
      return
    }
    void onConnectWallet()
  }

  function onTemplateChange(nextTemplateId: string) {
    setSelectedTemplateId(nextTemplateId)
  }

  const explorerBase = getExplorerBase(walletChainId)
  const txLink = lastTxHash ? `${explorerBase}/tx/${lastTxHash}` : ''
  const walletConnected = walletAccount !== null
  const isBusy = isConnecting || isGenerating || isSubmitting

  return (
    <main className="page">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <section className="hero reveal">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Starknet Zero-Knowledge Account Abstraction</p>
            <h1>Starkmoat</h1>
          </div>
          <button
            className="wallet-cta"
            disabled={isConnecting}
            onClick={onWalletPrimaryClick}
            type="button"
          >
            {walletConnected ? `Disconnect ${shortHex(walletAddress)}` : 'Connect Wallet'}
          </button>
        </div>
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
            <button disabled={isConnecting} onClick={() => void onDisconnectWallet()} type="button">
              Disconnect Wallet
            </button>
          ) : (
            <button disabled={isConnecting} onClick={() => void onConnectWallet()} type="button">
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
          <button disabled={isGenerating} onClick={() => void onGenerateSecretAndLeaf()} type="button">
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
          <h2>Sepolia Presets</h2>
          <label>
            Call Template
            <select
              onChange={(event) => onTemplateChange(event.target.value)}
              value={selectedTemplate?.id ?? ''}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <p className="meta">{selectedTemplate?.description}</p>
          <p className="meta">
            Address source: {artifactSourceLabel}
            {artifactLoaded ? '' : ' (artifact not loaded yet)'}
          </p>
          <label>
            Preset Contract Address
            <input
              onChange={(event) => setPresetContractAddress(event.target.value)}
              value={presetContractAddress}
            />
          </label>

          {selectedTemplate?.templateArgs
            .filter((arg) => arg.source !== 'nullifier')
            .map((arg) => (
              <label key={arg.name}>
                {arg.label}
                <input
                  onChange={(event) =>
                    setTemplateValues((prev) => ({ ...prev, [arg.name]: event.target.value }))
                  }
                  placeholder={arg.placeholder}
                  value={templateValues[arg.name] ?? ''}
                />
              </label>
            ))}

          <button disabled={isBusy} onClick={() => void onAnonymousAction()} type="button">
            Submit Preset Invoke
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
        Presets use ABI-backed calldata compilation and auto-load addresses from
        `deployments/sepolia.json` (synced to `public/deployments/sepolia.json` on run).
      </div>
    </main>
  )
}

export default App
