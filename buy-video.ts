/**
 * Buy an AI-generated video over x402, with a wallet as the only credential.
 *
 * The flow:
 *   1. POST a prompt to the endpoint. Unpaid, it answers 402 with the exact
 *      USDC price for the clip length and model you asked for.
 *   2. @x402/fetch signs the payment with your wallet and retries the request.
 *   3. The paid POST returns the video URL in the same response when the
 *      render finishes within 45 seconds. It answers 200 at once (the
 *      X-Status-Url header carries a status URL with a signed claim ticket, the
 *      proof of purchase), sends a whitespace byte every 2 seconds while it
 *      waits, then one JSON object. Read `status` in that body.
 *   4. If the render takes longer (status "running"), poll the status URL
 *      (free, the render is already paid for) until it finishes.
 *   5. Download the file.
 *
 * Usage:
 *   cp .env.example .env   # add a Base or Solana wallet key holding a few USDC
 *   npm install
 *   npm run buy -- "a hedgehog wandering through a neon-lit alley at night"
 */
import { writeFile } from "node:fs/promises";
import { chainName, fetchWithPayment } from "./pay.js";

const ENDPOINT =
  process.env.X402_VIDEO_ENDPOINT ?? "https://www.trezalabs.com/api/x402/video";
// Model and length are only sent when set, so the endpoint picks its own
// defaults: minimax-h3 at its shortest length, or, with CLIP_IMAGE_URL, the
// cheapest model that takes an image at the length you ask for.
//
// Clip length. Each model sells its own: 5, 10 or 15 on minimax-h3,
// kling-3.0, kling-3.0-pro and seedance-2.5; 4, 6 or 8 on the three Veo
// models; 5 or 10 on wan-2.7.
const SECONDS = process.env.CLIP_SECONDS?.trim()
  ? Number(process.env.CLIP_SECONDS)
  : undefined;
const ASPECT = process.env.CLIP_ASPECT ?? "16:9"; // 16:9 or 9:16
// minimax-h3 (the default: cheap, sharp, rarely refuses, text only),
// veo-3.1-lite, wan-2.7, veo-3.1-fast, kling-3.0, kling-3.0-pro, seedance-2.5
// or veo-3.1. GET the endpoint with no parameters for what each one is for
// and its prices.
const MODEL = process.env.CLIP_MODEL?.trim() || undefined;
// Optional first frame: a public https JPEG, PNG or WebP up to 10 MB, cropped
// to CLIP_ASPECT. Every model except minimax-h3 takes one. Leave CLIP_MODEL
// unset and the cheapest model that takes an image at CLIP_SECONDS renders
// it: wan-2.7 for 5 or 10, kling-3.0 for 15, veo-3.1-lite otherwise.
const IMAGE_URL = process.env.CLIP_IMAGE_URL?.trim() || undefined;

const prompt =
  process.argv.slice(2).join(" ") ||
  "a manta ray gliding over a sunlit coral reef, slow cinematic drift";

async function main() {
  console.log(
    `Buying a ${SECONDS ? `${SECONDS}s` : "default-length"} ${ASPECT} clip on ${MODEL ?? "the default model"}${
      IMAGE_URL ? ` from ${IMAGE_URL}` : ""
    } for: "${prompt}"`
  );

  const res = await fetchWithPayment(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspectRatio: ASPECT,
      ...(SECONDS !== undefined ? { seconds: SECONDS } : {}),
      ...(MODEL ? { model: MODEL } : {}),
      ...(IMAGE_URL ? { image_url: IMAGE_URL } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Purchase failed (${res.status}): ${await res.text()}`);
  }

  // The status URL embeds a signed ticket: it is the only credential that can
  // claim this video, so in a real integration you would persist it. It
  // arrives in this header before the render has finished.
  const statusUrl = res.headers.get("x-status-url");
  if (statusUrl) console.log(`Paid. Claim ticket: ${statusUrl}`);
  console.log("Waiting up to 45 seconds for the render...");

  // The body completes when the render does, or after 45 seconds with status
  // "running". Leading whitespace (the keepalive bytes) is ignored by the JSON
  // parser.
  const order = await res.json();
  console.log(
    `Paid $${order.paidUsd} USDC on ${chainName(order.network)} for ${order.seconds}s on ${order.model} (tx ${order.transaction}).`
  );

  // The render is taking longer than the wait: poll the claim ticket.
  let status = order;
  while (status.status === "running") {
    console.log(`Run ${order.runId} is still rendering; polling the claim ticket...`);
    await new Promise((r) => setTimeout(r, status.pollAfterMs ?? 15_000));
    status = await (await fetch(order.statusUrl)).json();
    console.log(`  status: ${status.status}`);
  }

  if (!status.video) {
    // Nothing was charged for a failed render: the payment stays on the
    // wallet's balance, and retryUrl renders again without paying twice.
    throw new Error(
      `Run finished as "${status.status}" with no video. ${status.message ?? ""} ${
        status.retryUrl ? `Retry at ${status.retryUrl}` : JSON.stringify(status)
      }`
    );
  }

  // Use the URL exactly as given, query parameters included.
  const file = "video.mp4";
  const media = await fetch(status.video);
  await writeFile(file, Buffer.from(await media.arrayBuffer()));
  console.log(`Saved ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
