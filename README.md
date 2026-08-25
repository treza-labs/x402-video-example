# Buy an AI video with x402

A minimal buyer script for [Treza's](https://www.trezalabs.com/x402) pay-per-video endpoint: POST a prompt, let your wallet pay the HTTP 402 challenge in USDC on Base, and download the finished video. No account, no API key, no signup. The payment is the only credential.

```
npm install
cp .env.example .env    # add a Base wallet key holding a few USDC
npm run buy -- "a hedgehog wandering through a neon-lit alley at night"
```

A couple of minutes later there is a `video.mp4` in the working directory.

## What it costs

Price scales with clip length and is quoted per request by the 402 challenge itself, before any money moves:

| Clip | Price |
| ---- | ----- |
| 5 seconds | $1.64 |
| 10 seconds | $3.27 |
| 15 seconds | $4.90 |

In 16:9 or 9:16, set via `CLIP_SECONDS` and `CLIP_ASPECT` in `.env`. The rate derives from measured provider cost, so it moves when the underlying model's price moves. Current prices always come from the challenge: `curl -X POST` the endpoint with your prompt and no payment, and the 402 response quotes the exact price for what you asked.

Payments are EIP-3009 `transferWithAuthorization`, so the wallet needs USDC but no ETH for gas.

One gotcha worth knowing: `@x402/fetch` ships with a default spend control that caps any single payment at $1, which silently rejects every clip on this endpoint. The script raises the cap to $5 via `spendControls: { maxAmountPerPayment: "$5" }`, which covers the largest clip while still bounding what one payment can ever spend.

## How the flow works

1. The script POSTs `{"prompt", "seconds", "aspectRatio"}` to `https://www.trezalabs.com/api/x402/video`.
2. The server answers `402 Payment Required` with structured payment requirements: the exact price for that clip, USDC on Base, and the address to pay.
3. [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) signs the payment with the wallet and retries the request. The payment verifies and settles on-chain before the render starts.
4. The paid POST answers `202 Accepted` with a run id and a `statusUrl` carrying a signed claim ticket. The ticket is the proof of purchase, so persist it in a real integration.
5. The script polls the `statusUrl` (free, the render is already paid for) until the video URL appears, then downloads the file.

If you send more than a render ends up costing, the difference stays as balance keyed to your wallet and is spent by your next call.

## Reading more

- [Live demo with a settled transaction](https://www.trezalabs.com/x402)
- [Endpoint reference: sizes, prices, and the request flow](https://www.trezalabs.com/tools/x402-video-generation-api)
- [Engineering write-up: how the seller side works](https://www.trezalabs.com/blog/selling-video-generation-to-agents-for-usdc), including wallet-keyed accounts, dynamic pricing when the SDK's price hook cannot see the body, and two fail-open bugs worth checking your own x402 seller for
- [x402 protocol documentation](https://docs.x402.org/)

## License

MIT
