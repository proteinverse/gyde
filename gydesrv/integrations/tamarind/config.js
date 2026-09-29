import {readFileSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function computeConfig(env = process.env) {
    const provider = env.GYDE_COMPUTE_PROVIDER || 'slivka';
    if (!['slivka', 'tamarind'].includes(provider)) throw Error('Unknown GYDE_COMPUTE_PROVIDER');
    if (provider === 'slivka') return {provider};
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('Tamarind compute requires TLS verification');
    if (!['127.0.0.1', '::1'].includes(env.GYDE_HOST || '127.0.0.1') || env.GYDE_TLS_PORT)
        throw Error('Personal Tamarind compute requires a loopback GYDE_HOST and the local HTTP port');
    if (!env.GYDE_MOCK_USER || env.GYDE_OAUTH_ISSUER)
        throw Error('Personal Tamarind compute requires one local GYDE_MOCK_USER and no shared OIDC login');
    if (env.TAMARIND_API_KEY && env.TAMARIND_API_KEY_FILE) throw Error('Configure only one Tamarind credential source');
    let apiKey = env.TAMARIND_API_KEY;
    if (env.TAMARIND_API_KEY_FILE) {
        const info = statSync(env.TAMARIND_API_KEY_FILE);
        if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077)))
            throw Error('TAMARIND_API_KEY_FILE must be a private file (chmod 600)');
        apiKey = readFileSync(env.TAMARIND_API_KEY_FILE, 'utf8').trim();
    }
    if (!apiKey || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw Error('Configure a valid backend-only TAMARIND_API_KEY or TAMARIND_API_KEY_FILE');
    const origin = env.TAMARIND_ORIGIN || 'https://app.tamarind.bio';
    if (!['https://app.tamarind.bio', 'https://staging.tamarind.bio'].includes(origin))
        throw Error('TAMARIND_ORIGIN must be an official Tamarind API origin');
    const port = Number(env.GYDE_PORT || 3030);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid GYDE_PORT');
    const host = env.GYDE_HOST || '127.0.0.1';
    const localOrigin = `http://${host === '::1' ? '[::1]' : host}:${port}`;
    const projectTag = env.TAMARIND_PROJECT_ID;
    if (projectTag && !/^proj_[A-Za-z0-9_-]+$/.test(projectTag)) throw Error('Invalid TAMARIND_PROJECT_ID');
    return {provider, origin, apiKey, localOrigin, projectTag,
        // Separate job histories when the credential changes. Never return this to the UI.
        credentialId: createHash('sha256').update(`${origin}\0${apiKey}`).digest('hex'),
        maxBytes: 20 * 1024 * 1024};
}

// Apply before every route, including local dataset writes. Binding loopback alone
// does not stop a malicious website from making the browser spend a local API key.
export function personalAccess(config) {
    const expectedHost = new URL(config.localOrigin).host;
    return (req, res, next) => {
        const address = req.socket.remoteAddress;
        const origin = req.headers.origin;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
            req.headers.host !== expectedHost ||
            (origin && origin !== config.localOrigin) ||
            ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
            return res.status(403).json({error: 'Use this personal installation from its configured local origin.'});
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin !== config.localOrigin &&
            req.headers['x-gyde-local'] !== '1')
            return res.status(403).json({error: 'A same-origin request is required.'});
        res.set('Referrer-Policy', 'same-origin');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        next();
    };
}
