/**
 * Keep Treza's x402 Bazaar listings alive: one paid call per endpoint, on the
 * cheapest thing each one sells.
 *
 * The Bazaar drops a listing with no paid call in 30 days, and Treza emails
 * when one is within a week of that. Run this then (or name only the listings
 * the email lists).
 *
 * It always pays on Base, from PRIVATE_KEY, even when .env also holds a Solana
 * key. The Bazaar is Coinbase's, and it only counts payments Coinbase's
 * facilitator settles; Treza settles Solana payments with Dexter's, so a
 * Solana call would be a real purchase that resets nothing. In total it buys
 * about $1.49:
 *   video $0.42 (5s minimax-h3), speech $0.02, music $0.06, image $0.02,
 *   clip ~$0.05 (a two-minute NASA video), short $0.87 (stills).
 *
 * Usage:
 *   npm run keepalive                 # all six
 *   npm run keepalive -- clip short   # just these
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

const CALLS: Record<string, { script: string; args: string[]; env?: Record<string, string> }> = {
  video: { script: "buy-video.ts", args: ["a manta ray gliding over a sunlit coral reef, slow cinematic drift"] },
  speech: { script: "buy.ts", args: ["speech", "Hello from Treza."] },
  music: { script: "buy.ts", args: ["music", "calm ambient pad, soft piano, slow"] },
  image: { script: "buy.ts", args: ["image", "a lighthouse at dusk, simple flat illustration"], env: { BUY_OPTIONS: '{"model":"gpt-image-2","quality":"low"}' } },
  // NASA Johnson: a US government work, in the public domain, two minutes long.
  clip: { script: "buy.ts", args: ["clip", "https://www.youtube.com/watch?v=HncCaFHwkEY"] },
  short: { script: "buy.ts", args: ["short", "why the sky is blue"], env: { BUY_OPTIONS: '{"style":"stills"}' } },
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !CALLS[w]);
if (unknown.length) throw new Error(`Unknown listing(s): ${unknown.join(", ")}. Choose from ${Object.keys(CALLS).join(", ")}.`);

// Fail before the first purchase, not after five of them went through.
config();
if (!process.env.PRIVATE_KEY?.trim()) {
  throw new Error(
    "keepalive pays on Base, which is the only chain the Bazaar counts: add PRIVATE_KEY (a Base wallet holding a few USDC) to .env."
  );
}

const failed: string[] = [];
for (const name of wanted.length ? wanted : Object.keys(CALLS)) {
  const call = CALLS[name];
  console.log(`\n== ${name}`);
  const run = spawnSync("npx", ["tsx", call.script, ...call.args], {
    stdio: "inherit",
    env: { ...process.env, ...(call.env ?? {}), PAY_CHAIN: "base" },
  });
  if (run.status !== 0) failed.push(name);
}
if (failed.length) {
  console.error(`\nNot kept alive: ${failed.join(", ")}. A failed render keeps its payment on the wallet balance; its retryUrl (printed above) finishes it without paying twice.`);
  process.exit(1);
}
console.log("\nEvery listing got its paid call.");
