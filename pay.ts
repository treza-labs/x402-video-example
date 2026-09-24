/**
 * A fetch that pays x402 challenges from the wallet in .env: Base with
 * PRIVATE_KEY, or Solana with SOLANA_PRIVATE_KEY (the base58 secret key a
 * wallet like Phantom exports). Shared by every buy script here.
 */
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

// dotenv never overrides a variable the shell already has, even an empty one
// (a key prompt answered with Enter leaves one behind), which would hide the
// key in .env. An empty variable counts as unset.
for (const name of ["PRIVATE_KEY", "SOLANA_PRIVATE_KEY"]) {
  if (process.env[name] !== undefined && !process.env[name]!.trim()) delete process.env[name];
}
config();

// PAY_CHAIN=base or PAY_CHAIN=solana pays from that chain's wallet only, even
// when .env holds both keys. The keepalive sets base (see keepalive.ts).
const chain = process.env.PAY_CHAIN?.trim().toLowerCase();
if (chain && chain !== "base" && chain !== "solana") throw new Error(`PAY_CHAIN must be "base" or "solana", not "${chain}".`);
const evmKey = chain === "solana" ? undefined : process.env.PRIVATE_KEY?.trim();
const solanaKey = chain === "base" ? undefined : process.env.SOLANA_PRIVATE_KEY?.trim();
if (chain === "base" && !evmKey) {
  throw new Error("PAY_CHAIN=base needs PRIVATE_KEY in .env: a Base wallet holding a few USDC.");
}
if (chain === "solana" && !solanaKey) {
  throw new Error("PAY_CHAIN=solana needs SOLANA_PRIVATE_KEY in .env: a Solana wallet holding a few USDC.");
}
if (!evmKey && !solanaKey) {
  throw new Error(
    "Set PRIVATE_KEY (a Base wallet) or SOLANA_PRIVATE_KEY (a Solana wallet) in .env, holding a few USDC. See .env.example."
  );
}
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

/** A Base key with or without its 0x: MetaMask and Phantom both export it without. */
function evmPrivateKey(raw: string): `0x${string}` {
  const hex = raw.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("PRIVATE_KEY must be a Base (Ethereum) private key: 64 hex characters, with or without 0x.");
  }
  return `0x${hex}`;
}

// Neither chain needs gas money in the wallet. On Base the payment is an
// EIP-3009 transferWithAuthorization; on Solana it is a USDC transfer the
// facilitator co-signs as fee payer. Either way: USDC only. The endpoint lists
// both; registering only one chain makes the client pick that one.
const schemes = solanaKey
  ? [
      {
        network: SOLANA_MAINNET,
        client: new ExactSvmScheme(await createKeyPairSignerFromBytes(bs58.decode(solanaKey)), {
          ...(process.env.SOLANA_RPC_URL ? { rpcUrl: process.env.SOLANA_RPC_URL } : {}),
        }),
      },
    ]
  : [{ network: "eip155:8453" as const, client: new ExactEvmScheme(privateKeyToAccount(evmPrivateKey(evmKey!))) }];

export const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes,
  // The SDK's default spend control caps payments at $1, which silently
  // rejects many clips: the 15s default clip ($1.26) and most clips on the
  // other models (up to $4.90). $5 covers every offer while still bounding
  // what a bug in these scripts could ever spend in one payment.
  spendControls: { maxAmountPerPayment: "$5" },
});

/** "Base" or "Solana", from a response's network field. */
export function chainName(network: unknown): string {
  return String(network).startsWith("solana:") ? "Solana" : "Base";
}
