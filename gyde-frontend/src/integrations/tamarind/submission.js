// Retain an ambiguous attempt across dialog retries and page reloads. Only hashes
// and random request identifiers go into sessionStorage, never inputs or secrets.
const memory = new Map();
async function fingerprint(url, form) {
    const fields = [];
    for (const [key, value] of form.entries()) {
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        fields.push([key, hash]);
    }
    fields.sort(([a],[b]) => a.localeCompare(b));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([url, fields])));
    return 'gyde-pending-' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
}
// Dataset imports can align several columns at once. Queue their submissions
// within the backend's two-upload limit, without automatically retrying a POST.
const waiting = [];
let active = 0;
export async function submitTamarind(url, form) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await submitAttempt(url, form); }
    finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }
}

async function submitAttempt(url, form) {
    const fingerprintKey = await fingerprint(url, form);
    let key = memory.get(fingerprintKey);
    try { key ||= sessionStorage.getItem(fingerprintKey); } catch { /* Memory remains available. */ }
    key ||= crypto.randomUUID();
    memory.set(fingerprintKey, key);
    try { sessionStorage.setItem(fingerprintKey, key); } catch { /* Private browsing may deny storage. */ }
    const clear = () => {
        memory.delete(fingerprintKey);
        try { sessionStorage.removeItem(fingerprintKey); } catch {}
    };
    let response;
    try {
        response = await fetch(url, {method:'POST', body:form, headers:{'Idempotency-Key':key}, signal:AbortSignal.timeout(180000)});
        if (response.status < 500 && ![408, 409].includes(response.status)) {
            // Read/clone the success body before clearing the key: the connection
            // can drop after headers have arrived but before the job ID arrives.
            if (response.ok) await response.clone().json();
            clear();
            return response;
        }
    } catch { /* Reconcile read-only below; never automatically repeat a POST. */ }
    try {
        const recovered = await fetch(`/compute/tamarind/requests/${encodeURIComponent(key)}`, {signal:AbortSignal.timeout(30000)});
        if (recovered.ok) {
            await recovered.clone().json();
            clear();
            return recovered;
        }
    } catch { /* Preserve the same request key for a later explicit retry. */ }
    throw Error('Submission could not be confirmed. Open Recent compute jobs before starting another run. Retrying the same inputs will reuse this attempt.');
}
