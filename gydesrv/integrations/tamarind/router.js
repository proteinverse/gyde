import express from 'express';
import {catalog} from './catalog.js';
import {TamarindApiClient} from './client.js';
import {PersonalJobs} from './jobs.js';
import {multipart} from './multipart.js';
import {HttpError} from './errors.js';
import {admission, admittedHandler} from './admission.js';

export async function tamarindRouter({config, collection, client = new TamarindApiClient(config)}) {
    const router = express.Router(), jobs = new PersonalJobs(collection, client, catalog, config);
    await jobs.init();
    const wrap = admittedHandler;
    router.use(['/api', '/api2', '/media', '/media2', '/compute/tamarind'], admission(16), (_req, res, next) => {
        res.set('Cache-Control', 'no-store'); next();
    });
    router.get(['/api/services', '/api2/services', '/compute/tamarind/services'], (_req, res) => res.json({services: Object.values(catalog).map(
        ({id, name, description, parameters, tool, version}) => ({id, name, description, parameters, tool, version, provider: 'tamarind'}))}));
    router.post(['/api/services/:service/jobs', '/api2/services/:service/jobs', '/compute/tamarind/services/:service/jobs'], admission(2), wrap(async (req, res) => {
        if (!Object.hasOwn(catalog, req.params.service)) throw new HttpError(404, 'Tool not available');
        const form = await multipart(req, config.maxBytes);
        res.json(await jobs.submit(req.params.service, form, req.get('Idempotency-Key'), req.query.cache));
    }));
    router.get(['/api/jobs', '/api2/jobs', '/compute/tamarind/jobs'], wrap(async (_req, res) => res.json(await jobs.list())));
    router.get('/compute/tamarind/requests/:key', wrap(async (req, res) => res.json(await jobs.request(req.params.key))));
    router.get(['/api/jobs/:id', '/api2/jobs/:id', '/compute/tamarind/jobs/:id'], wrap(async (req, res) => res.json(await jobs.poll(req.params.id))));
    router.delete(['/api/jobs/:id', '/api2/jobs/:id', '/compute/tamarind/jobs/:id'], wrap(async (req, res) => res.json(await jobs.cancel(req.params.id))));
    router.get(['/api/jobs/:id/files', '/api2/jobs/:id/files', '/compute/tamarind/jobs/:id/files'], wrap(async (req, res) => res.json(await jobs.files(req.params.id))));
    router.get(['/media/:id/:index', '/media2/:id/:index', '/compute/tamarind/media/:id/:index'], admission(2), wrap(async (req, res) => {
        res.type('application/octet-stream').send(await jobs.file(req.params.id, req.params.index));
    }));
    // Fail closed: never forward an unimplemented compute route into another backend.
    router.use(['/api', '/api2', '/media', '/media2', '/compute/tamarind'], (_req, res) => res.status(404).json({error: 'Compute endpoint not available'}));
    router.use((error, _req, res, _next) => {
        res.status(error instanceof HttpError ? error.status : 500).json({error: error instanceof HttpError ? error.message : 'Compute request failed'});
    });
    return router;
}
