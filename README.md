# Buy an AI video with x402

A minimal buyer script for [Treza's](https://www.trezalabs.com/x402) pay-per-video endpoint: POST a prompt, let your wallet pay the HTTP 402 challenge in USDC on Base or Solana, and download the finished video. No account, no API key, no signup. The payment is the only credential. The same wallet also buys a voiceover, a music track or an image: see [Speech, music and images](#speech-music-and-images).

```
npm install
cp .env.example .env    # add a Base or a Solana wallet key holding a few USDC
npm run buy -- "a hedgehog wandering through a neon-lit alley at night"
```

The paid request returns the video in the same response when the render finishes within 45 seconds; otherwise the script polls the status URL it got back until the video is ready. Either way, when the script exits there is a `video.mp4` in the working directory.

## What it costs

Price scales with clip length and the model, and is quoted per request by the 402 challenge itself, before any money moves. Each model sells its own lengths:

| `CLIP_MODEL` | Prices (USDC) |
| ------------ | ------------- |
| `minimax-h3` (default) | 5 s $0.42, 10 s $0.84, 15 s $1.26 |
| `veo-3.1-lite` | 4 s $0.45, 6 s $0.68, 8 s $0.90 |
| `wan-2.7` | 5 s $0.70, 10 s $1.40 |
| `veo-3.1-fast` | 4 s $0.68, 6 s $1.01, 8 s $1.35 |
| `kling-3.0` | 5 s $0.89, 10 s $1.77, 15 s $2.65 |
| `kling-3.0-pro` | 5 s $1.18, 10 s $2.36, 15 s $3.53 |
| `seedance-2.5` | 5 s $1.64, 10 s $3.27, 15 s $4.90 |
| `veo-3.1` | 4 s $2.24, 6 s $3.36, 8 s $4.48 |

In 16:9 or 9:16, set via `CLIP_SECONDS`, `CLIP_ASPECT` and `CLIP_MODEL` in `.env`. Hailuo 3 is the default: sharp, cheap, and it refuses very few prompts. Seedance 2.5 costs about four times as much as the default and has a strict content filter (prompts that resemble a brand, a broadcast, or a famous scene are refused, and so are photos of real people; a refusal is not charged, and the response carries a `retryUrl` that renders a reworded prompt without paying again). The rates derive from measured provider cost, so they move when a model's price moves. Current models and prices always come from the endpoint itself: `GET` it with no parameters for the offer list, or `curl -X POST` it with your prompt and no payment, and the 402 response quotes the exact price for what you asked. Only `prompt`, `seconds`, `aspectRatio`, `model`, `image_url` and `async` are read; any other field is refused with a 400 before payment, so nothing you send is silently ignored.

`CLIP_SECONDS` and `CLIP_MODEL` are optional, and the script only sends them when they are set. Left unset, the endpoint renders its default: `minimax-h3` at 5 seconds.

To animate your own image, set `CLIP_IMAGE_URL` to a public https JPEG, PNG or WebP of up to 10 MB. The script sends it as `image_url`, and the video starts from it, cropped to `CLIP_ASPECT`. Leave `CLIP_MODEL` unset and the cheapest model that takes an image at your length renders it: `wan-2.7` for 5 or 10 seconds, `kling-3.0` for 15, and `veo-3.1-lite` for 4, 6, 8 or no length, and the 402 quotes that model's price. Any model except `minimax-h3` can be named instead. The image is checked before the payment settles, so one that cannot be used costs nothing.

## Paying on Base or Solana

The endpoint's 402 challenge lists the same price twice: USDC on Base first, then USDC on Solana. The script pays from whichever wallet you give it in `.env`:

| Variable | Wallet | Notes |
| -------- | ------ | ----- |
| `PRIVATE_KEY` | Base | A `0x` private key holding USDC on Base. Payments are EIP-3009 `transferWithAuthorization`, so no ETH is needed for gas |
| `SOLANA_PRIVATE_KEY` | Solana | The base58 64-byte secret key, as Phantom and most Solana wallets export it, holding USDC on Solana. No SOL is needed: the facilitator pays the network fee. When set, it is used instead of `PRIVATE_KEY` |
| `SOLANA_RPC_URL` | Solana | Optional. A Solana mainnet RPC for the client to read the USDC mint from; the public endpoint is used when unset |

Either way the wallet needs USDC on the chain it pays from, and nothing else. Use a small, dedicated hot wallet, never a main one. Paid on Solana, the response's `transaction` is a base58 signature rather than a `0x` hash. A Base wallet and a Solana wallet are separate accounts on Treza, so credit left on one is not visible to the other.

One gotcha worth knowing: `@x402/fetch` ships with a default spend control that caps any single payment at $1, which silently rejects many clips (the 15-second default clip, and most clips on the other models). The script raises the cap to $5 via `spendControls: { maxAmountPerPayment: "$5" }`, which covers the largest clip ($4.90) while still bounding what one payment can ever spend.

## How the flow works

1. The script POSTs `{"prompt", "aspectRatio"}`, plus `"seconds"`, `"model"` and `"image_url"` when `CLIP_SECONDS`, `CLIP_MODEL` and `CLIP_IMAGE_URL` are set, to `https://www.trezalabs.com/api/x402/video`.
2. The server answers `402 Payment Required` with structured payment requirements: the exact price for that clip on that model, in USDC on Base and on Solana, and the address to pay on each.
3. [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) signs the payment with the wallet (through `@x402/evm` for Base, or `@x402/svm` for Solana) and retries the request. The payment verifies and settles on-chain before the render starts.
4. The paid POST answers `200` at once with an `X-Status-Url` header carrying a signed claim ticket, the proof of purchase (persist it in a real integration), sends a whitespace byte every 2 seconds while it waits, which JSON parsers ignore, and ends with one JSON object. When the render finishes within 45 seconds, `status` is `success` and the body carries the `video` URL; `error` or `partial` carries a `retryUrl` that renders again without paying twice.
5. When the render takes longer, the body says `"status": "running"`, and the script polls the `statusUrl` (free, the render is already paid for) until it finishes. Then it downloads the file, using the `video` URL exactly as given.

If you send more than a render ends up costing, the difference stays as balance keyed to your wallet and is spent by your next call.

## Speech, music and images

`buy.ts` buys from Treza's other pay-per-call endpoints the same way, and saves the file next to it:

```
npm run buy:speech -- "Welcome back. Here is today's forecast."   # speech.mp3
npm run buy:music -- "warm lo-fi hip hop, soft piano, 80 bpm"     # music.mp3
npm run buy:image -- "a lighthouse on a sea cliff at golden hour" # image.png
```

| Endpoint | Sells | Price (USDC) |
| -------- | ----- | ------------ |
| `/api/x402/speech` | An ElevenLabs voiceover of up to 3,000 characters, 13 voices, Eleven v3 or Multilingual v2 | $0.42 per 1,000 characters, minimum $0.02 |
| `/api/x402/music` | An original Google Lyria 3 track: a 30-second clip, or a full song with `"model": "lyria-3-pro"` | $0.06 clip, $0.12 song |
| `/api/x402/image` | One image on Nano Banana (default), Nano Banana 2 or Pro, GPT Image 2, Seedream 5.0 Pro, FLUX.2 Pro or Recraft V4.1, square to 21:9, up to 4K | From $0.02, by model and setting |

Put any other settings in `BUY_OPTIONS` as JSON, merged into the body, e.g. `BUY_OPTIONS='{"voice":"rachel"}'` for speech or `BUY_OPTIONS='{"model":"nano-banana-pro","resolution":"4K","aspectRatio":"16:9"}'` for an image. `GET` any endpoint with no parameters for its full menu, and read the exact price off its 402 before paying. These usually come back in a few seconds, inside the same response.

## Reading more

- [Live demo with a settled transaction](https://www.trezalabs.com/x402)
- [Endpoint reference: sizes, prices, and the request flow](https://www.trezalabs.com/tools/x402-video-generation-api)
- [Engineering write-up: how the seller side works](https://www.trezalabs.com/blog/selling-video-generation-to-agents-for-usdc), including wallet-keyed accounts, dynamic pricing when the SDK's price hook cannot see the body, and two fail-open bugs worth checking your own x402 seller for
- [x402 protocol documentation](https://docs.x402.org/)

## License

MIT
