import type { Address, GetAccountInfoApi, GetTokenAccountBalanceApi, Rpc } from '@solana/kit';
import { base64ToBytes } from './base64';

export async function fetchAccountBytes(
  rpc: Rpc<GetAccountInfoApi>,
  address: Address,
): Promise<Uint8Array | null> {
  const res = await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
  if (!res.value) return null;
  return base64ToBytes(res.value.data[0]);
}

export async function fetchTokenBalance(
  rpc: Rpc<GetTokenAccountBalanceApi>,
  address: Address,
): Promise<bigint> {
  try {
    const res = await rpc.getTokenAccountBalance(address).send();
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

/**
 * Like fetchTokenBalance, but a transient RPC failure (rate limit, timeout) is
 * `null` ("unknown"), not 0. Only a genuinely missing token account is 0.
 */
export async function tryFetchTokenBalance(
  rpc: Rpc<GetTokenAccountBalanceApi>,
  address: Address,
): Promise<bigint | null> {
  try {
    const res = await rpc.getTokenAccountBalance(address).send();
    return BigInt(res.value.amount);
  } catch (err) {
    const text = `${err instanceof Error ? err.message : ''} ${(err as { cause?: { message?: string } })?.cause?.message ?? ''}`;
    return /could not find account|invalid param/i.test(text) ? 0n : null;
  }
}
