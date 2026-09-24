/**
 * Buy a voiceover, a music track, an image, a clip of a YouTube video or a
 * narrated short over x402, the same way buy-video.ts buys a generated clip:
 * POST, let the wallet pay the 402, get the file.
 *
 * Usage:
 *   npm run buy:speech -- "Welcome back. Here is today's forecast."
 *   npm run buy:music -- "warm lo-fi hip hop, soft piano, vinyl crackle, 80 bpm"
 *   npm run buy:image -- "a lighthouse on a sea cliff at golden hour"
 *   npm run buy:clip -- "https://www.youtube.com/watch?v=KtTXyBJ2N30"
 *   npm run buy:short -- "how octopuses taste the world with their arms"
 *
 * Optional settings go in BUY_OPTIONS as JSON, merged into the body:
 *   BUY_OPTIONS='{"voice":"rachel"}'                          speech
 *   BUY_OPTIONS='{"model":"lyria-3-pro"}'                     music (a full song)
 *   BUY_OPTIONS='{"model":"nano-banana-pro","resolution":"4K","aspectRatio":"16:9"}'   image
 *   BUY_OPTIONS='{"aspectRatio":"1:1"}'                       clip
 *   BUY_OPTIONS='{"style":"stills","voice":"rachel"}'         short
 * GET the endpoint with no parameters for every option and price.
 */
import { writeFile } from "node:fs/promises";
import { chainName, fetchWithPayment } from "./pay.js";

const PRODUCTS = {
  speech: { input: "text", field: "audio", example: "Welcome back. Today we are looking at three small habits that make a big difference." },
  music: { input: "prompt", field: "audio", example: "warm lo-fi hip hop, soft piano chords, vinyl crackle, relaxed 80 bpm groove" },
  image: { input: "prompt", field: "image", example: "a lighthouse on a sea cliff at golden hour, soft mist, cinematic wide shot" },
  // A NASA interview: a US government work, in the public domain.
  clip: { input: "url", field: "video", example: "https://www.youtube.com/watch?v=KtTXyBJ2N30" },
  short: { input: "topic", field: "video", example: "how octopuses taste the world with their arms" },
} as const;

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

async function main() {
  const [kind, ...words] = process.argv.slice(2);
  const product = PRODUCTS[kind as keyof typeof PRODUCTS];
  if (!product) throw new Error(`Usage: tsx buy.ts <${Object.keys(PRODUCTS).join("|")}> "<text or prompt>"`);
  const base = process.env.X402_BASE_URL ?? "https://www.trezalabs.com";
  const endpoint = `${base}/api/x402/${kind}`;
  const options = process.env.BUY_OPTIONS ? JSON.parse(process.env.BUY_OPTIONS) : {};
  const body = { [product.input]: words.join(" ") || product.example, ...options };
  console.log(`Buying ${kind}: ${JSON.stringify(body)}`);

  const res = await fetchWithPayment(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Purchase failed (${res.status}): ${await res.text()}`);
  const statusUrl = res.headers.get("x-status-url");
  if (statusUrl) console.log(`Paid. Claim ticket: ${statusUrl}`);

  // The body ends when the file is ready, or after 45 seconds with status
  // "running" (clips and shorts take a few minutes, so they usually do).
  // Leading whitespace (the keepalive bytes) is ignored by JSON.
  const order = await res.json();
  console.log(`Paid $${order.paidUsd} USDC on ${chainName(order.network)} (tx ${order.transaction}).`);
  let status = order;
  while (status.status === "running") {
    await new Promise((r) => setTimeout(r, status.pollAfterMs ?? 15_000));
    status = await (await fetch(order.statusUrl)).json();
    console.log(`  status: ${status.status}`);
  }
  const url = status[product.field];
  if (!url) {
    // A failure keeps the unspent payment on the wallet balance: retryUrl
    // finishes or retries it without paying twice.
    throw new Error(`Finished as "${status.status}" with no file. ${status.message ?? ""} ${status.retryUrl ?? JSON.stringify(status)}`);
  }

  // Use the URL exactly as given, query parameters included.
  const file = await fetch(url);
  const ext = EXTENSIONS[(file.headers.get("content-type") ?? "").split(";")[0]] ?? "bin";
  const name = `${kind}.${ext}`;
  await writeFile(name, Buffer.from(await file.arrayBuffer()));
  console.log(`Saved ${name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
