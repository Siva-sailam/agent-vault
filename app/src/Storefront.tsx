import { useEffect, useMemo, useRef, useState } from 'react';
import { address, createSolanaRpc } from '@solana/kit';
import { useConnect, useConnectedWallet, useWallets, WalletReadyGate } from '@solana/kit-plugin-wallet/react';
import { ACTIVE_VAULT } from './vaults';
import { decodeVaultRules, getAssociatedTokenAddress, getVaultPdas, ixTokenTransfer, WINDOW_SECONDS } from './lib/program';
import { fetchAccountBytes, fetchTokenBalance } from './lib/rpcHelpers';
import { useApprovalAction } from './hooks/useApprovalAction';
import { ApprovalModal } from './components/ApprovalModal';
import { agentStyle, merchantStyle } from './storefront/merchantStyle';
import { usePolicyState } from './hooks/usePolicyState';
import type { AppClient } from './providers';
import './App.css';
import './storefront/storefront.css';

const AGENT_SERVICE_URL = 'http://localhost:4021';
const DEVNET_URL = 'https://api.devnet.solana.com';
const QUICK_AMOUNTS = [5, 10, 20, 50];

// ---------------------------------------------------------------------------
// Live feed from the agent service
// ---------------------------------------------------------------------------
type AgentEvent =
  | { id: number; ts: number; kind: 'info'; message: string }
  | {
      id: number;
      ts: number;
      kind: 'spend';
      agent?: string;
      merchant: string;
      merchantLabel: string;
      amount: number;
      success: boolean;
      reason: string | null;
      signature: string | null;
      solscanUrl: string | null;
      version?: 'v1' | 'v2';
      refusedBeforeSigning?: boolean;
      detail?: string | null;
      errorName?: string | null;
      spentSoFar: number | null;
      weeklyBudget: number | null;
    }
  | { id: number; ts: number; kind: 'pause'; message: string }
  | { id: number; ts: number; kind: 'resumed'; auto?: boolean }
  | { id: number; ts: number; kind: 'complete'; message: string };

function useAgentEvents() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds = useRef(new Set<number>());

  useEffect(() => {
    const source = new EventSource(`${AGENT_SERVICE_URL}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      const event: AgentEvent = JSON.parse(e.data);
      if (seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      setEvents((prev) => [...prev, event].sort((a, b) => a.id - b.id));
    };
    return () => source.close();
  }, []);

  return { events, connected };
}

type Meta = {
  symbol: string;
  agents: { name: string; address: string; merchants: string[] }[];
  merchants: string[];
  scenario: boolean;
  /** Agents (V1 names) that also have a V2 (policy server) path. */
  v2Agents?: string[];
};

/** What the checkout may offer — read from the agent service so the page and
 * the service always agree. Re-fetched whenever the service (re)connects. */
function useMeta(connected: boolean) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    if (!connected) return;
    fetch(`${AGENT_SERVICE_URL}/meta`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [connected]);
  return meta;
}

async function pressContinue() {
  await fetch(`${AGENT_SERVICE_URL}/continue`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Balances: main wallet, vault, and the selected agent's own wallet
// ---------------------------------------------------------------------------
type Balances = { main: bigint | null; vault: bigint | null; agent: bigint | null };

function useBalances(meta: Meta | null, agentName: string, nonce: number): Balances {
  const [bal, setBal] = useState<Balances>({ main: null, vault: null, agent: null });
  const rpc = useMemo(() => createSolanaRpc(DEVNET_URL), []);

  useEffect(() => {
    if (!meta) return;
    let stop = false;
    const agentAddr = meta.agents.find((a) => a.name === agentName)?.address;

    async function tick() {
      const mint = address(ACTIVE_VAULT.mint);
      const owner = address(ACTIVE_VAULT.owner);
      const [mainAta, pdas] = await Promise.all([getAssociatedTokenAddress(owner, mint), getVaultPdas(owner, mint)]);
      const agentAta = agentAddr ? await getAssociatedTokenAddress(address(agentAddr), mint) : null;
      const [main, vault, agent] = await Promise.all([
        fetchTokenBalance(rpc, mainAta),
        fetchTokenBalance(rpc, pdas.vault),
        agentAta ? fetchTokenBalance(rpc, agentAta) : Promise.resolve(0n),
      ]);
      if (!stop) setBal({ main, vault, agent });
    }

    tick().catch(() => {});
    const id = setInterval(() => tick().catch(() => {}), 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [meta, agentName, nonce, rpc]);

  return bal;
}

// ---------------------------------------------------------------------------
// Weekly budgets, read from the vault's rules account so every agent shows one
// (not only agents that have already paid in this session)
// ---------------------------------------------------------------------------
type Budget = { spent: number; limit: number };

function useChainBudgets(meta: Meta | null, nonce: number): Map<string, Budget> {
  const [budgets, setBudgets] = useState<Map<string, Budget>>(new Map());
  const rpc = useMemo(() => createSolanaRpc(DEVNET_URL), []);

  useEffect(() => {
    if (!meta) return;
    let stop = false;

    async function tick() {
      const pdas = await getVaultPdas(address(ACTIVE_VAULT.owner), address(ACTIVE_VAULT.mint));
      const bytes = await fetchAccountBytes(rpc, pdas.rules);
      if (!bytes || stop) return;
      const rules = decodeVaultRules(bytes);
      const now = Math.floor(Date.now() / 1000);
      const next = new Map<string, Budget>();
      for (const a of rules.agents) {
        const name = meta!.agents.find((m) => m.address === a.key)?.name;
        if (!name) continue;
        // An elapsed window resets on the agent's next spend, so show it as unspent.
        const expired = now - a.windowStart >= WINDOW_SECONDS;
        next.set(name, { spent: expired ? 0 : Number(a.spentSoFar), limit: Number(a.weeklyBudget) });
      }
      setBudgets(next);
    }

    tick().catch(() => {});
    const id = setInterval(() => tick().catch(() => {}), 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [meta, nonce, rpc]);

  return budgets;
}

// ---------------------------------------------------------------------------
// Wallet connection (only needed for "Main wallet" payments)
// ---------------------------------------------------------------------------
function WalletStatus({ client }: { client: AppClient }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect } = useConnect(client);

  if (connected) {
    const onDevnet = connected.account.chains.includes('solana:devnet');
    const a = connected.account.address;
    return (
      <div className={`sf-wallet ${onDevnet ? 'ok' : 'warn'}`}>
        <span>
          👛 {connected.wallet.name} · {a.slice(0, 4)}…{a.slice(-4)}
        </span>
        {!onDevnet && <small>Switch Phantom to Devnet (Settings → Developer Settings → Testnet Mode), then reconnect.</small>}
      </div>
    );
  }
  if (wallets.length === 0) {
    return (
      <div className="sf-wallet warn">
        <span>No devnet wallet found</span>
        <small>In Phantom turn on Testnet Mode → Solana Devnet, then refresh.</small>
      </div>
    );
  }
  return (
    <div className="sf-wallet">
      {wallets.map((w) => (
        <button key={w.name} className="sf-connect" onClick={() => connect(w)}>
          Connect {w.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
type FeedItem = {
  key: string;
  ts: number;
  via: 'agent' | 'wallet';
  agent?: string;
  merchantLabel: string;
  amount: number;
  success: boolean;
  reason: string | null;
  solscanUrl?: string | null;
  version?: 'v1' | 'v2';
  refusedBeforeSigning?: boolean;
  detail?: string | null;
  errorName?: string | null;
};

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function Avatar({ label, size = 40 }: { label: string; size?: number }) {
  const s = merchantStyle(label);
  return (
    <span className="sf-avatar" style={{ width: size, height: size, background: s.background, fontSize: size * 0.5 }}>
      {s.emoji}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
type Mode = 'agent' | 'wallet';
type Version = 'v1' | 'v2';

export function Storefront({ client }: { client: AppClient }) {
  const { events, connected } = useAgentEvents();
  const meta = useMeta(connected);
  const sym = meta?.symbol ?? ACTIVE_VAULT.symbol;

  const [mode, setMode] = useState<Mode>('agent');
  const [versionPick, setVersionPick] = useState<Version>('v1');
  const [agentName, setAgentName] = useState('');
  const [merchantPick, setMerchantPick] = useState('');
  const [amount, setAmount] = useState('20');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletConnected = useConnectedWallet(client);
  const walletOnDevnet = Boolean(walletConnected?.account.chains.includes('solana:devnet'));
  const approval = useApprovalAction(client);
  const [walletFeed, setWalletFeed] = useState<FeedItem[]>([]);
  const pendingWalletOrder = useRef<{ merchantLabel: string; amount: number } | null>(null);

  const agents = useMemo(() => meta?.agents ?? [], [meta]);
  const activeAgent = agents.find((a) => a.name === agentName) ?? agents[0];
  // Merchants offered: this agent's own list for an agent payment, everything
  // (grouped by category) for a main-wallet payment.
  const groups = useMemo(() => {
    if (!meta) return [];
    if (mode === 'agent') {
      return activeAgent ? [{ title: agentStyle(activeAgent.name).category, merchants: activeAgent.merchants }] : [];
    }
    return meta.agents.map((a) => ({ title: agentStyle(a.name).category, merchants: a.merchants }));
  }, [meta, mode, activeAgent]);
  const hasV2 = Boolean(activeAgent && meta?.v2Agents?.includes(activeAgent.name));
  const version: Version = mode === 'agent' && hasV2 ? versionPick : 'v1';
  const policy = usePolicyState();
  const offered = useMemo(() => groups.flatMap((g) => g.merchants), [groups]);
  const merchant = offered.includes(merchantPick) ? merchantPick : (offered[0] ?? '');

  const nonce = events.length + walletFeed.length;
  const bal = useBalances(meta, activeAgent?.name ?? '', nonce);

  // Record a finished main-wallet payment in the feed.
  useEffect(() => {
    const order = pendingWalletOrder.current;
    if (!order) return;
    const s = approval.state;
    if (s.stage !== 'done' && s.stage !== 'error') return;
    pendingWalletOrder.current = null;
    setWalletFeed((prev) => [
      ...prev,
      {
        key: `w-${Date.now()}`,
        ts: Date.now(),
        via: 'wallet',
        merchantLabel: order.merchantLabel,
        amount: order.amount,
        success: s.stage === 'done',
        reason: s.stage === 'error' ? (s.errorMessage ?? 'Payment did not go through') : null,
        solscanUrl: s.solscanUrl,
      },
    ]);
  }, [approval.state]);

  const isPaused = events[events.length - 1]?.kind === 'pause';
  const pauseMessage = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'pause') return e.message;
      if (e.kind === 'resumed') return null;
    }
    return null;
  }, [events]);

  const chainBudgets = useChainBudgets(meta, nonce);
  const v2Budget = (() => {
    const a = policy.state?.agents.find((x) => x.name === `${activeAgent?.name}-v2`);
    return a ? { spent: a.spent, limit: a.weeklyBudget } : undefined;
  })();
  const budget = version === 'v2' ? v2Budget : activeAgent ? chainBudgets.get(activeAgent.name) : undefined;

  const feed: FeedItem[] = useMemo(() => {
    const fromService: FeedItem[] = events
      .filter((e): e is Extract<AgentEvent, { kind: 'spend' }> => e.kind === 'spend')
      .map((e) => ({
        key: `a-${e.id}`,
        ts: e.ts,
        via: 'agent' as const,
        agent: e.agent,
        merchantLabel: e.merchantLabel,
        amount: e.amount,
        success: e.success,
        reason: e.reason,
        solscanUrl: e.solscanUrl,
        version: e.version ?? 'v1',
        refusedBeforeSigning: e.refusedBeforeSigning,
        detail: e.detail,
        errorName: e.errorName,
      }));
    return [...fromService, ...walletFeed].sort((a, b) => b.ts - a.ts);
  }, [events, walletFeed]);

  const amountNum = Number(amount);
  const amountOk = Number.isInteger(amountNum) && amountNum >= 1;
  const merchantWallet = ACTIVE_VAULT.merchants.find((m) => m.label === merchant)?.wallet;

  async function payWithAgent() {
    if (!activeAgent) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${AGENT_SERVICE_URL}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: activeAgent.name, merchant, amount: amountNum, version }),
      });
      const body = await res.json();
      // A payment the program refuses is a normal result and shows up in the
      // feed; only a rejected request is an error here.
      if (!res.ok) setError(body.error ?? 'Order failed');
    } catch {
      setError('Could not reach the agent service.');
    } finally {
      setPending(false);
    }
  }

  async function payFromMainWallet() {
    if (!walletConnected || !merchantWallet) return;
    setError(null);
    const mint = address(ACTIVE_VAULT.mint);
    const source = await getAssociatedTokenAddress(address(walletConnected.account.address), mint);
    const dest = await getAssociatedTokenAddress(address(merchantWallet), mint);
    pendingWalletOrder.current = { merchantLabel: merchant, amount: amountNum };
    await approval.run(`Pay ${amountNum} ${sym} to ${merchant} from your main wallet`, () => [
      ixTokenTransfer(client.payer, source, dest, BigInt(amountNum)),
    ]);
  }

  const insufficientMain = mode === 'wallet' && bal.main != null && amountOk && BigInt(amountNum) > bal.main;
  const canPay =
    amountOk &&
    Boolean(merchant) &&
    !pending &&
    connected &&
    (mode === 'agent' ? Boolean(activeAgent) : walletOnDevnet && !insufficientMain);

  const fromLabel =
    mode === 'agent'
      ? `${activeAgent?.name ?? 'agent'} card · paid from the ${version === 'v2' ? 'V2 multisig vault' : 'vault'}`
      : 'your main wallet';

  return (
    <div className="sf">
      <div className="sf-blob sf-blob-a" />
      <div className="sf-blob sf-blob-b" />
      <div className="sf-blob sf-blob-c" />

      <main className="sf-shell">
        <header className="sf-header">
          <div>
            <div className="sf-brand">
              <span className="sf-logo">◎</span> {sym} Pay
            </div>
            <h1>
              Stablecoin checkout <span>for AI agents</span>
            </h1>
          </div>
          <div className={`sf-live ${connected ? 'on' : ''}`}>
            <i /> {connected ? 'Live · devnet' : 'Connecting to the agent service…'}
          </div>
        </header>

        {isPaused && (
          <section className="sf-pause">
            <div>
              <strong>⏸ Paused</strong>
              <p>{pauseMessage}</p>
            </div>
            <button onClick={() => pressContinue()}>Continue anyway</button>
          </section>
        )}

        <div className="sf-grid">
          <section className="sf-card sf-checkout">
            <h2>Checkout</h2>

            <div className="sf-seg" role="tablist" aria-label="Pay with">
              <button className={mode === 'agent' ? 'on' : ''} onClick={() => setMode('agent')} role="tab" aria-selected={mode === 'agent'}>
                🤖 Agent card
              </button>
              <button className={mode === 'wallet' ? 'on' : ''} onClick={() => setMode('wallet')} role="tab" aria-selected={mode === 'wallet'}>
                👛 Main wallet
              </button>
            </div>

            {mode === 'agent' && agents.length > 0 && (
              <>
                <label className="sf-label">Agent</label>
                <div className="sf-pills">
                  {agents.map((a) => (
                    <button key={a.name} className={`sf-pill ${activeAgent?.name === a.name ? 'on' : ''}`} onClick={() => setAgentName(a.name)}>
                      {agentStyle(a.name).emoji} {a.name}
                    </button>
                  ))}
                </div>
                {hasV2 && (
                  <>
                    <label className="sf-label">Enforcement</label>
                    <div className="sf-seg" role="tablist" aria-label="Rules enforced by">
                      <button className={version === 'v1' ? 'on' : ''} onClick={() => setVersionPick('v1')} role="tab" aria-selected={version === 'v1'}>
                        V1 · on-chain program
                      </button>
                      <button className={version === 'v2' ? 'on' : ''} onClick={() => setVersionPick('v2')} role="tab" aria-selected={version === 'v2'}>
                        V2 · policy server
                      </button>
                    </div>
                    {version === 'v2' && !policy.online && <p className="sf-error">Policy server is offline — V2 payments will be refused.</p>}
                  </>
                )}
                {budget && (
                  <div className="sf-budget">
                    <div className="sf-budget-row">
                      <span>Weekly budget</span>
                      <strong>
                        {budget.spent} / {budget.limit} {sym}
                      </strong>
                    </div>
                    <div className="sf-budget-track">
                      <div style={{ width: `${Math.min(100, (budget.spent / budget.limit) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </>
            )}

            {mode === 'wallet' && (
              <>
                <label className="sf-label">Wallet</label>
                <WalletReadyGate client={client} fallback={<div className="sf-wallet">Looking for wallets…</div>}>
                  <WalletStatus client={client} />
                </WalletReadyGate>
              </>
            )}

            <label className="sf-label">{mode === 'agent' ? 'Merchant (on this agent’s list)' : 'Merchant'}</label>
            {groups.map((g) => (
              <div key={g.title} className="sf-group">
                {mode === 'wallet' && <div className="sf-group-title">{g.title}</div>}
                <div className="sf-merchants">
                  {g.merchants.map((m) => (
                    <button key={m} className={`sf-merchant ${merchant === m ? 'on' : ''}`} onClick={() => setMerchantPick(m)}>
                      <Avatar label={m} size={38} />
                      <span>{m}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!meta && <p className="sf-dim">Waiting for the agent service…</p>}

            <label className="sf-label" htmlFor="sf-amount">
              Amount
            </label>
            <div className="sf-amount">
              <input id="sf-amount" type="number" min="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span>{sym}</span>
            </div>
            <div className="sf-quick">
              {QUICK_AMOUNTS.map((n) => (
                <button key={n} className={amountNum === n ? 'on' : ''} onClick={() => setAmount(String(n))}>
                  {n}
                </button>
              ))}
            </div>

            <div className="sf-route">
              <span>From</span> <b>{fromLabel}</b> <span>→</span> <b>{merchant || '…'}</b>
            </div>

            <button
              className="sf-pay"
              disabled={!canPay}
              onClick={() => (mode === 'agent' ? payWithAgent() : payFromMainWallet())}
            >
              {pending
                ? 'Sending…'
                : mode === 'agent'
                  ? `Pay ${amountOk ? amountNum : 0} ${sym} with agent card`
                  : !walletConnected
                    ? 'Connect your wallet to pay'
                    : insufficientMain
                      ? `Not enough ${sym} in main wallet`
                      : `Pay ${amountOk ? amountNum : 0} ${sym} from main wallet`}
            </button>
            {error && <p className="sf-error">{error}</p>}
            <p className="sf-fine">
              {mode === 'agent'
                ? version === 'v2'
                  ? 'The agent signs, then the policy server checks the rules BEFORE it co-signs. A refused payment never becomes a transaction.'
                  : 'The agent signs this itself. The vault’s rules decide whether it goes through.'
                : 'You approve this in your wallet. The vault and the agent are not involved.'}
            </p>
          </section>

          <section className="sf-card sf-activity">
            <h2>Live activity</h2>
            {feed.length === 0 && (
              <div className="sf-empty">
                <span>✨</span>
                <p>No payments yet. Place one on the left and watch it land here.</p>
              </div>
            )}
            {feed.map((e) => (
              <div className={`sf-feed ${e.success ? 'ok' : 'bad'}`} key={e.key}>
                <Avatar label={e.merchantLabel} size={42} />
                <div className="sf-feed-main">
                  <div className="sf-feed-title">
                    <b>
                      {e.amount} {sym}
                    </b>{' '}
                    <span>→ {e.merchantLabel}</span>
                  </div>
                  <div className="sf-feed-meta">
                    <span className={`sf-via ${e.via}`}>{e.via === 'agent' ? `🤖 ${e.agent ?? 'agent'}` : '👛 main wallet'}</span>
                    {e.via === 'agent' && <span className="sf-via">{e.version === 'v2' ? 'V2 · policy server' : 'V1 · on-chain'}</span>}
                    <span>{timeLabel(e.ts)}</span>
                    {e.solscanUrl && (
                      <a href={e.solscanUrl} target="_blank" rel="noreferrer">
                        Solscan ↗
                      </a>
                    )}
                  </div>
                  {!e.success && e.via === 'agent' && e.version === 'v2' && e.refusedBeforeSigning && (
                    <div className="sf-feed-reason">
                      <b>Refused BEFORE SIGNING by the policy server</b>
                      <br />
                      Reason: {e.reason}
                      {e.detail ? ` (${e.detail})` : ''}
                      <br />
                      No transaction was created. No fee.
                    </div>
                  )}
                  {!e.success && e.via === 'agent' && e.version === 'v2' && !e.refusedBeforeSigning && (
                    <div className="sf-feed-reason">
                      <b>Approved by the policy server, but the payment failed</b>
                      <br />
                      Reason: {e.reason}
                      {e.detail ? ` (${e.detail})` : ''}
                    </div>
                  )}
                  {!e.success && e.via === 'agent' && e.version !== 'v2' && e.reason && (
                    <div className="sf-feed-reason">
                      <b>Refused ON-CHAIN by the vault program</b>
                      <br />
                      {e.errorName ? <>Error: {e.errorName} — </> : null}
                      {e.reason}
                      <br />
                      The transaction reached the chain and failed — the fee was still paid.
                    </div>
                  )}
                  {!e.success && e.via === 'wallet' && e.reason && <div className="sf-feed-reason">{e.reason}</div>}
                </div>
                <span className={`sf-status ${e.success ? 'ok' : 'bad'}`}>{e.success ? 'Paid' : 'Refused'}</span>
              </div>
            ))}
          </section>
        </div>
      </main>

      <ApprovalModal state={approval.state} onClose={approval.dismiss} />
    </div>
  );
}
