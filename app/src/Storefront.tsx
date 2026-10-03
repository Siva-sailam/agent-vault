import { useEffect, useMemo, useRef, useState } from 'react';
import { MERCHANT_CATALOGUE } from './catalogue';
import { MerchantIcon } from './components/MerchantIcon';
import './App.css';

const AGENT_SERVICE_URL = 'http://localhost:4021';

type AgentEvent =
  | { id: number; ts: number; kind: 'info'; message: string }
  | {
      id: number;
      ts: number;
      kind: 'spend';
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

async function pressContinue() {
  await fetch(`${AGENT_SERVICE_URL}/continue`, { method: 'POST' });
}

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function merchantKeyFor(label: string) {
  return label.toLowerCase().replace(/\s+/g, '');
}

export function Storefront() {
  const { events, connected } = useAgentEvents();

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
          {MERCHANT_CATALOGUE.map((m) => (
            <div key={m.label} className="merchant-tile">
              <MerchantIcon merchantKey={merchantKeyFor(m.label)} size={44} />
              <span className="merchant-tile-label">{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      {latestSpendState && (
        <section className="panel">
          <h2>Agent budget</h2>
          <div className="budget-summary">
            <span>Spent this window</span>
            <strong>
              {latestSpendState.spentSoFar}
              {latestSpendState.weeklyBudget != null && <> / {latestSpendState.weeklyBudget}</>} Demo USD
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
                {e.amount} Demo USD to {e.merchantLabel}{' '}
                <span className={`status-pill ${e.success ? 'ok' : 'refused'}`}>{e.success ? 'Paid' : 'Refused'}</span>
              </p>
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
