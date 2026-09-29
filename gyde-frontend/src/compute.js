let config = {provider: 'slivka'};

export function isTamarindCompute() {
    return (process.env.NODE_ENV === 'test' ? process.env.REACT_APP_COMPUTE_PROVIDER : config.provider) === 'tamarind';
}

export async function loadComputeConfig() {
    const response = await fetch('/compute/config');
    // Compatibility with existing GYDE servers that predate provider discovery.
    if (response.status === 404) return config;
    if (!response.ok) throw Error('Compute configuration unavailable');
    const value = await response.json();
    if (!['slivka', 'tamarind'].includes(value.provider)) throw Error('Invalid compute provider');
    config = {provider: value.provider};
    return config;
}

export async function computeRequest(input, init) {
    const response = await fetch(input, init);
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error || `Compute request failed (${response.status})`);
    }
    return response.json();
}
