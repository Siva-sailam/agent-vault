import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@solana/kit';
import type { AppClient } from '../providers';
import { getAssociatedTokenAddress, getVaultPdas, decodeVaultRules, type VaultRulesState } from '../lib/program';
import { fetchAccountBytes, fetchTokenBalance } from '../lib/rpcHelpers';

export type VaultAddresses = Awaited<ReturnType<typeof getVaultPdas>>;

export type VaultState = {
  loading: boolean;
  pdas: VaultAddresses | null;
  ownerAta: Address | null;
  rules: VaultRulesState | null;
  vaultBalance: bigint;
  ownerBalance: bigint;
  refresh: () => void;
};

const POLL_MS = 6000;

export function useVaultState(client: AppClient, owner: Address | null, mint: Address): VaultState {
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pdas, setPdas] = useState<VaultAddresses | null>(null);
  const [ownerAta, setOwnerAta] = useState<Address | null>(null);
  const [rules, setRules] = useState<VaultRulesState | null>(null);
  const [vaultBalance, setVaultBalance] = useState(0n);
  const [ownerBalance, setOwnerBalance] = useState(0n);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!owner) {
      setLoading(false);
      setPdas(null);
      setRules(null);
      return;
    }
    setLoading(true);
    (async () => {
      const nextPdas = await getVaultPdas(owner, mint);
      const nextOwnerAta = await getAssociatedTokenAddress(owner, mint);
      const [rulesBytes, vaultBal, ownerBal] = await Promise.all([
        fetchAccountBytes(client.rpc, nextPdas.rules),
        fetchTokenBalance(client.rpc, nextPdas.vault),
        fetchTokenBalance(client.rpc, nextOwnerAta),
      ]);
      if (cancelled) return;
      setPdas(nextPdas);
      setOwnerAta(nextOwnerAta);
      setRules(rulesBytes ? decodeVaultRules(rulesBytes) : null);
      setVaultBalance(vaultBal);
      setOwnerBalance(ownerBal);
      setLoading(false);
    })().catch((e) => {
      console.error('useVaultState refresh failed', e);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [client, owner, mint, tick]);

  useEffect(() => {
    if (!owner) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [owner, refresh]);

  return { loading, pdas, ownerAta, rules, vaultBalance, ownerBalance, refresh };
}
