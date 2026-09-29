import {HttpError} from './errors.js';

const MAX_RESPONSE = 50 * 1024 * 1024;
export async function boundedBody(response, max = MAX_RESPONSE) {
    if (Number(response.headers.get('content-length')) > max) {
        await response.body?.cancel();
        throw new HttpError(502, 'Tamarind response exceeds the transfer limit');
    }
    const chunks = []; let length = 0;
    for await (const chunk of response.body || []) {
        length += chunk.length;
        if (length > max) throw new HttpError(502, 'Tamarind response exceeds the transfer limit');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

// Storage URLs come only from an authenticated Tamarind response. No arbitrary
// browser URL is accepted, no redirects are followed, and no API key leaves the API origin.
export function storageUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new HttpError(502, 'Invalid Tamarind storage URL'); }
    const s3 = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
    const cloudfront = /^[a-z0-9]+\.cloudfront\.net$/;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !(s3.test(url.hostname) || cloudfront.test(url.hostname)))
        throw new HttpError(502, 'Unexpected Tamarind storage destination');
    return url.href;
}

export class TamarindApiClient {
    constructor(config, request = fetch) { this.config = config; this.request = request; }
    async call(path, {method = 'GET', body, text = false} = {}) {
        if (!path.startsWith('/api/') || path.includes('://') || path.includes('\\')) throw Error('Invalid API path');
        let response;
        try {
            response = await this.request(this.config.origin + path, {method, redirect: 'error',
                headers: {'x-api-key': this.config.apiKey, Accept: 'application/json',
                    ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
                body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)});
            if (!response.ok) {
                await response.body?.cancel();
                const status = [400, 401, 403, 404, 409, 413, 422, 429].includes(response.status) ? response.status : 502;
                // Do not echo upstream bodies: they can contain input data, signed URLs or credentials.
                const messages = {400: 'Tamarind rejected the tool settings or project. Check the selected parameters.',
                    401: 'Tamarind rejected the API key. Update the backend credential and restart GYDE.',
                    403: 'Your Tamarind account permissions, project policy or compute budget do not allow this request.',
                    404: 'Tamarind job or file was not found.', 409: 'Tamarind reported a conflict. Check the existing job before resubmitting.',
                    413: 'This input exceeds Tamarind’s upload limit.', 422: 'Tamarind rejected these tool parameters.',
                    429: 'Tamarind rate limit reached. Wait before retrying.'};
                throw new HttpError(status, messages[status] || 'Tamarind is temporarily unavailable.');
            }
            if (response.status === 202) { await response.body?.cancel(); throw new HttpError(409, 'Tamarind is still preparing the result. Retry the download shortly.'); }
            const bytes = await boundedBody(response);
            if (text) return bytes.toString('utf8');
            try { return JSON.parse(bytes); } catch { throw new HttpError(502, 'Invalid response from Tamarind'); }
        } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(503, 'Could not reach Tamarind. An interrupted submission may still be running.');
        }
    }
    async upload(filename, bytes) {
        const prepared = await this.call('/api/getPresignedUploadUrl', {method: 'POST', body: {filename}});
        if (typeof prepared.key !== 'string' || !prepared.key.endsWith('/' + filename))
            throw new HttpError(502, 'Unexpected Tamarind upload reference');
        const response = await this.request(storageUrl(prepared.uploadUrl), {method: 'PUT', body: bytes,
            headers: {'Content-Type': 'application/octet-stream'}, redirect: 'error', signal: AbortSignal.timeout(60000)});
        await response.body?.cancel();
        if (!response.ok) throw new HttpError(502, 'Tamarind input upload failed');
        return filename;
    }
    async submit(jobName, type, settings) {
        const response = await this.call('/api/submit-job', {method: 'POST', text: true,
            body: {jobName, type, settings, ...(this.config.projectTag ? {projectTag: this.config.projectTag} : {})}});
        if (response.trim() !== `${jobName} submitted to queue.`)
            throw new HttpError(502, 'Submission could not be confirmed. GYDE will look up the saved job name.');
    }
    job(jobName) { return this.call(`/api/jobs?${new URLSearchParams({jobName})}`); }
    cancel(jobName) { return this.call('/api/cancelJob', {method: 'POST', body: {jobName}}); }
    async files(job) {
        // The public /files endpoint lists one directory at a time. Walk only the
        // submitted job prefix, never the user's account root or unrelated jobs.
        const prefix = `${job.JobName}/`;
        if (!job.User || !job.JobName) throw new HttpError(502, 'Missing Tamarind job identity');
        const queue = [job.JobName], visited = new Set(), keys = [];
        while (queue.length) {
            const folder = queue.shift();
            if (visited.has(folder)) continue;
            visited.add(folder);
            if (visited.size > 100) throw new HttpError(502, 'Too many result directories');
            const rows = await this.call(`/api/files?${new URLSearchParams({folder, includeFolders: 'true'})}`);
            if (!Array.isArray(rows)) throw new HttpError(502, 'Invalid Tamarind file list');
            for (const row of rows) {
                const key = row;
                if (typeof key !== 'string' || !key.startsWith(prefix)) throw new HttpError(502, 'Unexpected result path');
                if (key === prefix) continue; // S3 may include the directory marker itself.
                const relative = key.slice(prefix.length).replace(/\/$/, '');
                if (!relative || relative.split('/').some(p => !p || p === '.' || p === '..') || /[\\\x00-\x1f]/.test(relative))
                    throw new HttpError(502, 'Invalid result path');
                if (key.endsWith('/')) queue.push(`${job.JobName}/${relative}`);
                else keys.push(`${job.User}/${key}`);
                if (keys.length + queue.length > 10000) throw new HttpError(502, 'Too many result files');
            }
        }
        return keys;
    }
    async file(jobName, path) {
        const signed = await this.call('/api/result', {method: 'POST', body: {jobName, fileName: path}});
        const response = await this.request(storageUrl(signed), {redirect: 'error', signal: AbortSignal.timeout(60000)});
        if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, 'Tamarind result download failed'); }
        return boundedBody(response);
    }
}
