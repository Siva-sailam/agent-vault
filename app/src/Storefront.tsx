import { useEffect, useMemo, useRef, useState } from 'react';
import { address, createSolanaRpc } from '@solana/kit';
import { useConnect, useConnectedWallet, useWallets, WalletReadyGate } from '@solana/kit-plugin-wallet/react';
import { ACTIVE_VAULT } from './vaults';
import { getAssociatedTokenAddress, getVaultPdas, ixTokenTransfer } from './lib/program';
import { fetchTokenBalance } from './lib/rpcHelpers';
import { useApprovalAction } from './hooks/useApprovalAction';
import { ApprovalModal } from './components/ApprovalModal';
import { agentStyle, merchantStyle } from './storefront/merchantStyle';
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
      signature: string;
      solscanUrl: string;
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

function BalanceTile({
  emoji,
  label,
  hint,
  value,
  symbol,
  tone,
}: {
  emoji: string;
  label: string;
  hint: string;
  value: bigint | null;
  symbol: string;
  tone: 'violet' | 'pink' | 'lime';
}) {
  const prev = useRef<bigint | null>(null);
  const [delta, setDelta] = useState<{ amount: bigint; id: number } | null>(null);

  useEffect(() => {
    if (value == null) return;
    if (prev.current != null && value !== prev.current) {
      setDelta({ amount: value - prev.current, id: Date.now() });
    }
    prev.current = value;
  }, [value]);

  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 3500);
    return () => clearTimeout(t);
  }, [delta]);

  return (
    <div className={`sf-balance sf-tone-${tone}`}>
      <div className="sf-balance-top">
        <span className="sf-balance-emoji">{emoji}</span>
        <span className="sf-balance-label">{label}</span>
      </div>
      <div className="sf-balance-value">
        {value == null ? '…' : value.toString()}
        <span>{symbol}</span>
        {delta && (
          <em key={delta.id} className={delta.amount < 0n ? 'down' : 'up'}>
            {delta.amount > 0n ? '+' : ''}
            {delta.amount.toString()}
          </em>
        )}
      </div>
      <div className="sf-balance-hint">{hint}</div>
    </div>
  );
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
  solscanUrl?: string;
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

export function Storefront({ client }: { client: AppClient }) {
  const { events, connected } = useAgentEvents();
  const meta = useMeta(connected);
  const sym = meta?.symbol ?? ACTIVE_VAULT.symbol;

  const [mode, setMode] = useState<Mode>('agent');
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

  const budgetByAgent = useMemo(() => {
    const m = new Map<string, { spent: number; limit: number }>();
    for (const e of events) {
      if (e.kind === 'spend' && e.agent && e.spentSoFar != null && e.weeklyBudget != null) {
        m.set(e.agent, { spent: e.spentSoFar, limit: e.weeklyBudget });
      }
    }
    return m;
  }, [events]);
  const budget = activeAgent ? budgetByAgent.get(activeAgent.name) : undefined;

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
        body: JSON.stringify({ agent: activeAgent.name, merchant, amount: amountNum }),
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

  const fromLabel = mode === 'agent' ? `${activeAgent?.name ?? 'agent'} card · paid from the vault` : 'your main wallet';

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

        <section className="sf-balances">
          <BalanceTile emoji="👛" label="Main wallet" hint="Your own money" value={bal.main} symbol={sym} tone="violet" />
          <BalanceTile emoji="🏦" label="Vault" hint="Funds the agent cards" value={bal.vault} symbol={sym} tone="pink" />
          <BalanceTile
            emoji={agentStyle(activeAgent?.name ?? '').emoji}
            label={`${activeAgent?.name ?? 'Agent'} wallet`}
            hint="The agent holds nothing"
            value={bal.agent}
            symbol={sym}
            tone="lime"
          />
        </section>

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
                ? 'The agent signs this itself. The vault’s rules decide whether it goes through.'
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
                    <span>{timeLabel(e.ts)}</span>
                    {e.solscanUrl && (
                      <a href={e.solscanUrl} target="_blank" rel="noreferrer">
                        Solscan ↗
                      </a>
                    )}
                  </div>
                  {!e.success && e.reason && <div className="sf-feed-reason">{e.reason}</div>}
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
