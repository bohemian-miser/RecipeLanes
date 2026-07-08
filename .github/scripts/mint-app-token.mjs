// Mint a GitHub App installation token (prints it to stdout, no deps).
//
// Used by the Gemini agent workflows: installation tokens expire after 1 hour
// and agent runs can exceed that, so a background loop re-mints via this
// script and refreshes gh's file-based auth (see "Configure agent GitHub
// auth" workflow steps).
//
// Env: APP_ID, APP_PRIVATE_KEY (PEM), REPO ("owner/name")

import crypto from 'node:crypto';

const { APP_ID, APP_PRIVATE_KEY, REPO } = process.env;
if (!APP_ID || !APP_PRIVATE_KEY || !REPO) {
    console.error('mint-app-token: APP_ID, APP_PRIVATE_KEY and REPO env vars are required');
    process.exit(1);
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = b64u(JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID }));
const sig = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).end().sign(APP_PRIVATE_KEY);
const jwt = `${header}.${payload}.${b64u(sig)}`;

async function gh(url, opts = {}) {
    const r = await fetch(`https://api.github.com${url}`, {
        ...opts,
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
    return r.json();
}

const installation = await gh(`/repos/${REPO}/installation`);
const { token } = await gh(`/app/installations/${installation.id}/access_tokens`, { method: 'POST' });
process.stdout.write(token);
