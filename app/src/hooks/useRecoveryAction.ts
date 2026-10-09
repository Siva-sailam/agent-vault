import { useCallback, useState } from 'react';
import {
  address,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  assertIsTransactionModifyingSigner,
  type Base64EncodedWireTransaction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getTransferCheckedInstruction } from '@solana-program/token';
import type { AppClient } from '../providers';
import { getAssociatedTokenAddress, explainError } from '../lib/program';
import { solscanTx } from '../lib/solscan';
import v2 from '../lib/v2-vaults.json';
import type { ApprovalState } from './useApprovalAction';

export const AGENT_SERVICE_URL = 'http://localhost:4021';
export type V2Agent = (typeof v2.agents)[number];

type CosignReply = { ok: boolean; reason?: string; detail?: string; transaction?: string };

async function cosign(body: object): Promise<CosignReply> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_SERVICE_URL}/v2/recovery/cosign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'AgentServiceUnavailable', detail: 'Start the agent service (it holds the agent key).' };
  }
  return res.json();
}

/**
 * RECOVERY (owner + agent; the policy server is not involved).
 *
 * Order matters, and is chosen so it works whether or not the wallet rewrites
 * the transaction: the wallet signs FIRST, then the agent service signs the
 * exact bytes the wallet signed. (A wallet that modifies a message after the
 * agent signed would invalidate the agent's signature; kit's wallet signer is
 * explicitly a "modifying" signer for this reason.)
 *
 *   1. Build ONE TransferChecked: vault -> owner's own aUSD account,
 *      multiSigners [owner, agent], fee payer = owner.
 *   2. Pre-check with the agent service (nothing signed yet) so a refusal
 *      shows up BEFORE Phantom asks for approval.
 *   3. Phantom signs.
 *   4. Agent service re-verifies, checks the owner's signature, adds the
 *      agent's signature.
 *   5. Submit + confirm.
 */
export function useRecoveryAction(client: AppClient) {
  const [state, setState] = useState<ApprovalState>({ stage: 'idle', label: '' });

  const run = useCallback(
    async (agent: V2Agent, amount: number): Promise<boolean> => {
      const label = `Recover ${amount} aUSD from ${agent.name}`;
      setState({ stage: 'awaiting-wallet', label });
      try {
        const payer = client.payer;
        assertIsTransactionModifyingSigner(payer);
        if (payer.address !== v2.owner) throw new Error('Connect the vault owner wallet to recover funds.');
        if (!Number.isInteger(amount) || amount < 1) throw new Error('Enter a whole number of aUSD.');

        const ownerAta = await getAssociatedTokenAddress(address(v2.owner), address(v2.mint));
        const ix = getTransferCheckedInstruction({
          source: address(agent.vault),
          mint: address(v2.mint),
          destination: ownerAta,
          authority: address(agent.multisig),
          amount: BigInt(amount),
          decimals: v2.decimals,
          multiSigners: [createNoopSigner(address(v2.owner)), createNoopSigner(address(agent.address))],
        });
        const { value: blockhash } = await client.rpc.getLatestBlockhash().send();
        const compiled = compileTransaction(
          pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayer(address(v2.owner), m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
            (m) => appendTransactionMessageInstructions([ix], m),
          ),
        );
        const b64 = (tx: Parameters<typeof getBase64EncodedWireTransaction>[0]) => getBase64EncodedWireTransaction(tx);

        const pre = await cosign({ agent: agent.v1Name, precheck: true, transaction: b64(compiled) });
        if (!pre.ok) throw new Error(`${pre.reason}${pre.detail ? ` — ${pre.detail}` : ''}`);

        const [ownerSigned] = await payer.modifyAndSignTransactions([compiled]); // pops up Phantom

        setState({ stage: 'confirming', label });
        const res = await cosign({ agent: agent.v1Name, transaction: b64(ownerSigned) });
        if (!res.ok || !res.transaction) throw new Error(`${res.reason}${res.detail ? ` — ${res.detail}` : ''}`);

        const full = getTransactionDecoder().decode(getBase64Encoder().encode(res.transaction));
        assertIsFullySignedTransaction(full);
        const signature = await client.rpc
          .sendTransaction(res.transaction as Base64EncodedWireTransaction, { encoding: 'base64', preflightCommitment: 'confirmed' })
          .send();

        let onChainError: unknown = null;
        for (let i = 0; i < 30; i++) {
          const { value } = await client.rpc.getSignatureStatuses([signature]).send();
          const st = value[0];
          if (st?.confirmationStatus && st.confirmationStatus !== 'processed') {
            onChainError = st.err ?? null;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (onChainError) {
          setState({ stage: 'error', label, signature, solscanUrl: solscanTx(signature), errorMessage: explainError(onChainError) });
          return false;
        }
        setState({ stage: 'done', label, signature, solscanUrl: solscanTx(signature) });
        return true;
      } catch (err) {
        setState({ stage: 'error', label, errorMessage: err instanceof Error ? err.message : explainError(err) });
        return false;
      }
    },
    [client],
  );

  const dismiss = useCallback(() => setState({ stage: 'idle', label: '' }), []);
  return { state, run, dismiss };
}
