/**
 * Buy an AI-generated video over x402, with a wallet as the only credential.
 *
 * The flow:
 *   1. POST a prompt to the endpoint. Unpaid, it answers 402 with the exact
 *      USDC price for the clip length you asked for.
 *   2. @x402/fetch signs the payment with your wallet and retries the request.
 *   3. The paid POST answers 202 with a status URL carrying a signed claim
 *      ticket. That ticket is the proof of purchase.
 *   4. Poll the status URL (free, the render is already paid for) until the
 *      video URL appears, then download the file.
 *
 * Usage:
 *   cp .env.example .env   # add a Base wallet key holding a few USDC
 *   npm install
 *   npm run buy -- "a hedgehog wandering through a neon-lit alley at night"
 */
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

config();

const ENDPOINT =
  process.env.X402_VIDEO_ENDPOINT ?? "https://www.trezalabs.com/api/x402/video";
const SECONDS = Number(process.env.CLIP_SECONDS ?? 5); // 5, 10, or 15
const ASPECT = process.env.CLIP_ASPECT ?? "16:9"; // 16:9 or 9:16

const prompt =
  process.argv.slice(2).join(" ") ||
  "a manta ray gliding over a sunlit coral reef, slow cinematic drift";

const key = process.env.PRIVATE_KEY;
if (!key) {
  throw new Error(
    "Set PRIVATE_KEY in .env to a Base wallet key holding a few USDC. See .env.example."
  );
}

// Payments are EIP-3009 transferWithAuthorization: the facilitator submits the
// transaction, so the wallet needs USDC but no ETH for gas.
const account = privateKeyToAccount(key as `0x${string}`);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
  // The SDK's default spend control caps payments at $1, below the cheapest
  // clip ($1.64). $5 covers every size on offer while still bounding what a
  // bug in this script could ever spend in one payment.
  spendControls: { maxAmountPerPayment: "$5" },
});

async function main() {
  console.log(`Buying a ${SECONDS}s ${ASPECT} clip for: "${prompt}"`);

  const res = await fetchWithPayment(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, seconds: SECONDS, aspectRatio: ASPECT }),
  });
  const order = await res.json();
  if (!res.ok) {
    throw new Error(`Purchase failed (${res.status}): ${JSON.stringify(order)}`);
  }

  console.log(
    `Paid $${order.paidUsd} USDC on Base (tx ${order.transaction}).`
  );
  console.log(`Run ${order.runId} is rendering; polling the claim ticket...`);

  // The status URL embeds a signed ticket: it is the only credential that can
  // claim this video, so in a real integration you would persist it.
  let status = order;
  while (status.status === "running") {
    await new Promise((r) => setTimeout(r, status.pollAfterMs ?? 15_000));
    status = await (await fetch(order.statusUrl)).json();
    console.log(`  status: ${status.status}`);
  }

  if (!status.video) {
    throw new Error(
      `Run finished as "${status.status}" with no video URL: ${JSON.stringify(status)}`
    );
  }

  const file = "video.mp4";
  const media = await fetch(status.video);
  await writeFile(file, Buffer.from(await media.arrayBuffer()));
  console.log(`Saved ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
