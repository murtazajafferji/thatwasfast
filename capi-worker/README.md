# CAPI Worker for thatwasfast.ai

## Deploy (5 min)

```bash
cd capi-worker
# 1. Log in to Cloudflare (opens browser once)
wrangler login

# 2. Set the Meta CAPI access token as a secret
echo "PASTE_META_TOKEN_HERE" | wrangler secret put META_ACCESS_TOKEN

# 3. Deploy
wrangler deploy
```

You'll get a URL like `https://thatwasfast-capi.<your-subdomain>.workers.dev`.

## Update client to point at the Worker

Once you have the URL, edit `../index.html`, `../lead-response/index.html`, etc.
Replace `CAPI_WORKER_URL` in the CAPI helper snippet with the workers.dev URL.

## (Optional) Custom domain

If `thatwasfast.ai` is on your Cloudflare zone:
1. Uncomment the `routes` block in `wrangler.toml`
2. Create a DNS record: `capi` → any AAAA/CNAME (Cloudflare auto-handles)
3. `wrangler deploy`
