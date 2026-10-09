// V2 payment path: the agent builds ONE TransferChecked from its own V2 vault,
// partially signs it (agent signature only — the policy server is the fee
// payer and the second multisig signer), and asks the policy server to
// authorize. The server verifies the transaction itself, then co-signs and
// submits. A refusal means nothing was signed by the server, nothing was
// submitted, and no fee was paid.
//
// Only the AGENT'S key is read here. Server and owner keys never are.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getTransferCheckedInstruction } from '@solana-program/token';

const here = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
export const POLICY_SERVER_URL = process.env.POLICY_SERVER_URL ?? 'http://127.0.0.1:4031';

/** Public V2 config written by policy-server/scripts/setup-v2.mjs, or null if V2 isn't set up. */
export function loadV2Config() {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'policy-server', 'v2.config.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** "food-ordering-agent" -> "food-ordering-agent-v2" */
export const v2NameOf = (v1Name) => `${v1Name}-v2`;

export async function createV2Path({ rpc, v2, merchantAtas }) {
  const signers = {};
  for (const [name, entry] of Object.entries(v2.agents)) {
    signers[name] = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, entry.keyFile), 'utf8'))),
    );
    if (signers[name].address !== entry.address) throw new Error(`${name}: key file does not match v2.config.json`);
  }
  const server = createNoopSigner(address(v2.policyServer.address));

  async function buildPartiallySigned(v2Name, destination, amount) {
    const entry = v2.agents[v2Name];
    const agent = signers[v2Name];
    const ix = getTransferCheckedInstruction({
      source: address(entry.vault),
      mint: address(v2.mint),
      destination: address(destination),
      authority: address(entry.multisig.address),
      amount: BigInt(amount),
      decimals: v2.decimals,
      multiSigners: [agent, server],
    });
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(server, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    );
    return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(msg));
  }

  /** @returns {Promise<{approved:boolean, reason?:string, detail?:string, signature?:string}>} */
  async function authorize(v2Name, label, amount) {
    const destination = merchantAtas[label];
    const transaction = await buildPartiallySigned(v2Name, destination, amount);
    try {
      const res = await fetch(`${POLICY_SERVER_URL}/v2/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction, intent: { merchant: destination, amount } }),
        signal: AbortSignal.timeout(90_000),
      });
      return await res.json();
    } catch (e) {
      // Server down: no payment possible (recovery path = owner + agent, M3b).
      return { approved: false, reason: 'PolicyServerUnavailable', detail: e.message };
    }
  }

  /** Budget/spent as the policy server sees it (best effort, for display). */
  async function agentBudget(v2Name) {
    try {
      const state = await (await fetch(`${POLICY_SERVER_URL}/v2/state`, { signal: AbortSignal.timeout(5000) })).json();
      const a = state.agents.find((x) => x.name === v2Name);
      return a ? { spent: a.spent, weeklyBudget: a.weeklyBudget } : null;
    } catch {
      return null;
    }
  }

  async function policyState() {
    const res = await fetch(`${POLICY_SERVER_URL}/v2/state`, { signal: AbortSignal.timeout(5000) });
    return res.json();
  }

  return { signers, authorize, agentBudget, policyState, buildPartiallySigned };
}
