import { useCallback, useState } from 'react';
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstructions,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
  assertIsTransactionModifyingSigner,
  type Instruction,
} from '@solana/kit';
import type { AppClient } from '../providers';
import { explainError } from '../lib/program';
import { solscanTx } from '../lib/solscan';

export type ApprovalStage = 'idle' | 'awaiting-wallet' | 'confirming' | 'done' | 'error';

export type ApprovalState = {
  stage: ApprovalStage;
  label: string;
  signature?: string;
  solscanUrl?: string;
  errorMessage?: string;
};

/**
 * Drives the single approval-modal flow used by every wallet-signed action
 * on this page: build instructions -> ask the wallet to sign (this is what
 * actually pops up Phantom; the promise below resolves only once approved,
 * or rejects if declined) -> submit -> poll for the real on-chain outcome.
 *
 * Sends with `skipPreflight: true` so even a refusal lands on-chain as a
 * real, inspectable transaction (same reasoning as the M7 agent-pay
 * script) — a control panel claiming to be trustworthy should be able to
 * show its work, including when it says no.
 *
 * No transaction-building logic lives here — callers pass in already-built
 * Instruction objects from lib/program.ts, unchanged from before this
 * redesign.
 */
export function useApprovalAction(client: AppClient) {
  const [state, setState] = useState<ApprovalState>({ stage: 'idle', label: '' });

  const run = useCallback(
    async (label: string, buildInstructions: () => Promise<Instruction[]> | Instruction[]): Promise<boolean> => {
      setState({ stage: 'awaiting-wallet', label });
      try {
        const instructions = await buildInstructions();
        const payer = client.payer;
        // The wallet plugin's signer implements modifyAndSignTransactions
        // whenever Phantom exposes `solana:signTransaction`, which it does —
        // this just proves that to the type system.
        assertIsTransactionModifyingSigner(payer);
        const { value: blockhash } = await client.rpc.getLatestBlockhash().send();

        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayer(payer.address, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        );
        const compiled = compileTransaction(message);

        // Pops up Phantom. Resolves on approval, throws on rejection.
        const [signed] = await payer.modifyAndSignTransactions([compiled]);

        setState({ stage: 'confirming', label });
        const wire = getBase64EncodedWireTransaction(signed);
        const signature = await client.rpc
          .sendTransaction(wire, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed' })
          .send();

        let onChainError: unknown = null;
        for (let i = 0; i < 30; i++) {
          const { value: statuses } = await client.rpc.getSignatureStatuses([signature]).send();
          const status = statuses[0];
          if (status && status.confirmationStatus && status.confirmationStatus !== 'processed') {
            onChainError = status.err ?? null;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (onChainError) {
          setState({
            stage: 'error',
            label,
            signature,
            solscanUrl: solscanTx(signature),
            errorMessage: explainError(onChainError),
          });
          return false;
        }

        setState({ stage: 'done', label, signature, solscanUrl: solscanTx(signature) });
        return true;
      } catch (err) {
        setState({ stage: 'error', label, errorMessage: explainError(err) });
        return false;
      }
    },
    [client],
  );

  const dismiss = useCallback(() => setState({ stage: 'idle', label: '' }), []);

  return { state, run, dismiss };
}
