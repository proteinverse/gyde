import {loadComputeConfig} from './compute';
loadComputeConfig().then(() => import('./Application')).catch(() => {
    document.getElementById('root').textContent = 'GYDE could not load its compute configuration. Reload to try again.';
});
