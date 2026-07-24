# mint-model-upload-url — one-time setup

Lets Colab mint a **fresh** model-bundle upload URL at the moment it
uploads, so a long training run can't outlive the URL (the old ~2-hour
pre-minted URL was the cause of finished models silently failing to
upload).

## 1. Set the signing secret (once)

Any long random string. It only ever lives on the server; the browser
and Colab receive a signed *ticket*, never this value.

```bash
# generate one:
openssl rand -hex 32
# set it:
supabase secrets set MODEL_UPLOAD_SECRET=<paste-the-random-hex>
```

## 2. Deploy the function

Colab has no Supabase JWT, so deploy **without** JWT verification — the
`issue` branch verifies the admin JWT itself:

```bash
supabase functions deploy mint-model-upload-url --no-verify-jwt
```

That's it. From then on, **Copy Colab cell** in the admin bakes a 7-day
ticket into the snippet; Colab redeems it for a fresh upload URL right
before uploading. No more expired-URL upload failures, regardless of how
long training takes.

## How it flows

1. Admin clicks *Copy Colab cell* → browser calls this function
   `{action:"issue"}` with the admin JWT → gets a 7-day HMAC ticket →
   embeds `REELINTEL_MINT_URL` + `REELINTEL_MINT_TICKET` in the snippet.
2. Training runs (any duration).
3. `colab_run.py` calls this function `{action:"redeem", ticket}` → gets
   a fresh signed upload URL → PUTs the bundle to `model-artifacts/pending/`.
4. Admin → Models → the bundle appears under *Pending bundles* → Import.

A local backup copy of the bundle also downloads to the training machine
automatically, so even a total upload failure never loses the model.
