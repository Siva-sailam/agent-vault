import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_VAULT } from './vaults';
import { MerchantIcon } from './components/MerchantIcon';
import './App.css';

const AGENT_SERVICE_URL = 'http://localhost:4021';

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
  | { id: number; ts: number; kind: 'resumed' }
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
  agents: { name: string; merchants: string[] }[];
  merchants: string[];
  scenario: boolean;
};

/** What the order form may offer — read from the agent service so the form and
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

function OrderForm({ meta }: { meta: Meta }) {
  const [agent, setAgent] = useState(meta.agents[0]?.name ?? '');
  const [merchant, setMerchant] = useState(meta.agents[0]?.merchants[0] ?? meta.merchants[0] ?? '');
  const [amount, setAmount] = useState('20');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickAgent(name: string) {
    setAgent(name);
    const first = meta.agents.find((a) => a.name === name)?.merchants[0];
    if (first) setMerchant(first);
  }

  async function placeOrder() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${AGENT_SERVICE_URL}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, merchant, amount: Number(amount) }),
      });
      const body = await res.json();
      // A payment the program refuses is a normal result and shows up in the
      // activity feed below; only a rejected request is an error here.
      if (!res.ok) setError(body.error ?? 'Order failed');
    } catch {
      setError('Could not reach the agent service.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <h2>Place an order</h2>
      <p className="hint">The agent signs the payment itself. The vault's rules decide whether it goes through.</p>
      <div className="add-agent-form">
        <select value={agent} onChange={(e) => pickAgent(e.target.value)} disabled={pending}>
          {meta.agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={pending}>
          {meta.merchants.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="row">
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            aria-label={`Amount in ${meta.symbol}`}
          />
          <button disabled={pending || !agent || !merchant || Number(amount) < 1} onClick={placeOrder}>
            {pending ? 'Sending…' : `Pay ${amount || 0} ${meta.symbol}`}
          </button>
        </div>
        {error && <p className="network-warning">{error}</p>}
      </div>
    </section>
  );
}

async function pressContinue() {
  await fetch(`${AGENT_SERVICE_URL}/continue`, { method: 'POST' });
}

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// The merchants shown: the demo vault's scenario agent's own four, else the catalogue.
const tileLabels = ACTIVE_VAULT.setupAgents?.[0].merchants ?? ACTIVE_VAULT.merchants.map((m) => m.label);

function merchantKeyFor(label: string) {
  return label.toLowerCase().replace(/\s+/g, '');
}

export function Storefront() {
  const { events, connected } = useAgentEvents();
  const meta = useMeta(connected);

  const isPaused = useMemo(() => events[events.length - 1]?.kind === 'pause', [events]);

  const pauseMessage = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'pause') return e.message;
      if (e.kind === 'resumed') return null;
    }
    return null;
  }, [events]);

  const latestSpendState = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'spend' && e.spentSoFar != null) return { spentSoFar: e.spentSoFar, weeklyBudget: e.weeklyBudget };
    }
    return null;
  }, [events]);

  const feed = useMemo(
    () => events.filter((e): e is Extract<AgentEvent, { kind: 'spend' }> => e.kind === 'spend').reverse(),
    [events],
  );

  return (
    <main className="storefront">
      <header>
        <h1>Storefront</h1>
        <p className="hint">{connected ? 'Live feed connected.' : 'Connecting to the agent service…'}</p>
      </header>

      <section>
        <div className="merchant-tiles">
          {tileLabels.map((label) => (
            <div key={label} className="merchant-tile">
              <MerchantIcon merchantKey={merchantKeyFor(label)} size={44} />
              <span className="merchant-tile-label">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {meta && <OrderForm meta={meta} />}

      {latestSpendState && (
        <section className="panel">
          <h2>Agent budget</h2>
          <div className="budget-summary">
            <span>Spent this window</span>
            <strong>
              {latestSpendState.spentSoFar}
              {latestSpendState.weeklyBudget != null && <> / {latestSpendState.weeklyBudget}</>} {ACTIVE_VAULT.symbol}
            </strong>
          </div>
        </section>
      )}

      {isPaused && (
        <section className="panel pause-banner">
          <h2>Paused</h2>
          <p>{pauseMessage}</p>
          <button onClick={() => pressContinue()}>Continue</button>
        </section>
      )}

      <section className="panel">
        <h2>Activity</h2>
        {feed.length === 0 && <p className="hint">Waiting for the agent to start…</p>}
        {feed.map((e) => (
          <div className="feed-row" key={e.id}>
            <MerchantIcon merchantKey={e.merchant} size={34} />
            <div className="feed-row-main">
              <p className="feed-row-title">
                {e.amount} {ACTIVE_VAULT.symbol} to {e.merchantLabel}{' '}
                <span className={`status-pill ${e.success ? 'ok' : 'refused'}`}>{e.success ? 'Paid' : 'Refused'}</span>
              </p>
              {e.agent && <p className="hint">{e.agent}</p>}
              {!e.success && <p className="feed-row-reason">{e.reason}</p>}
            </div>
            <div className="feed-row-right">
              <div>{timeLabel(e.ts)}</div>
              <a href={e.solscanUrl} target="_blank" rel="noreferrer">
                Solscan
              </a>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
