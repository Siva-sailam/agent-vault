export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}?cluster=devnet`;
}
