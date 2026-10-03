import type { ApprovalState } from '../hooks/useApprovalAction';
import { WalletIcon, SpinnerIcon, CheckIcon, AlertIcon } from './icons';

export function ApprovalModal({ state, onClose }: { state: ApprovalState; onClose: () => void }) {
  if (state.stage === 'idle') return null;

  const dismissible = state.stage === 'done' || state.stage === 'error';

  return (
    <div className="modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {state.stage === 'awaiting-wallet' && (
          <>
            <div className="modal-icon modal-icon-neutral">
              <WalletIcon size={32} />
            </div>
            <h2>Approve in your wallet</h2>
            <p className="modal-action">{state.label}</p>
            <p className="modal-hint">Look for the Phantom pop-up on your screen.</p>
          </>
        )}

        {state.stage === 'confirming' && (
          <>
            <div className="modal-icon modal-icon-neutral">
              <SpinnerIcon size={32} />
            </div>
            <h2>Confirming on-chain</h2>
            <p className="modal-action">{state.label}</p>
          </>
        )}

        {state.stage === 'done' && (
          <>
            <div className="modal-icon modal-icon-success">
              <CheckIcon size={32} />
            </div>
            <h2>Done</h2>
            <p className="modal-action">{state.label}</p>
            {state.solscanUrl && (
              <a className="modal-link" href={state.solscanUrl} target="_blank" rel="noreferrer">
                View on Solscan
              </a>
            )}
            <button className="modal-close" onClick={onClose}>
              Close
            </button>
          </>
        )}

        {state.stage === 'error' && (
          <>
            <div className="modal-icon modal-icon-error">
              <AlertIcon size={32} />
            </div>
            <h2>Didn't go through</h2>
            <p className="modal-action">{state.label}</p>
            <p className="modal-error-reason">{state.errorMessage}</p>
            {state.solscanUrl && (
              <a className="modal-link" href={state.solscanUrl} target="_blank" rel="noreferrer">
                View on Solscan
              </a>
            )}
            <button className="modal-close" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
