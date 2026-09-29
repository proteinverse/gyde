import {createHash, randomUUID} from 'node:crypto';
import {HttpError, requireId} from './errors.js';
import {outputFiles} from './outputFiles.js';

const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
function digest(service, form, projectTag) {
    const values = [service.id, service.version, projectTag || null,
        Object.entries(form.fields).sort(([a], [b]) => a.localeCompare(b)),
        Object.entries(form.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) =>
            [name, createHash('sha256').update(file.bytes).digest('hex')])];
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export class PersonalJobs {
    constructor(collection, client, catalog, config) {
        Object.assign(this, {collection, client, catalog, config});
        this.active = new Set();
    }
    async init() {
        await this.collection.createIndex({credentialId: 1, requestKey: 1}, {unique: true});
        await this.collection.createIndex({credentialId: 1, created: -1});
    }
    async owned(id) {
        requireId(id);
        const row = await this.collection.findOne({_id: id, credentialId: this.config.credentialId});
        if (!row) throw new HttpError(404, 'Job not found in this installation’s current credential history');
        return row;
    }
    async save(row, changes) {
        const query = {_id: row._id, credentialId: this.config.credentialId};
        // A late status/submit response must not undo completion or cancellation.
        if (changes.state) query.state = {$nin: [...terminal,
            ...(['PENDING', 'RUNNING', 'SUBMITTING', 'RECONCILING'].includes(changes.state) ? ['CANCELLING'] : [])]};
        await this.collection.updateOne(query, {$set: {...changes, updated: new Date()}});
        return this.owned(row._id);
    }
    status(row) {
        return {id: row._id, service: row.serviceId, '@url': `/compute/tamarind/jobs/${row._id}`,
            jobName: row.jobName, status: row.state, finished: terminal.has(row.state),
            message: row.message, created: row.created,
            resultUrl: `${this.config.origin}/app/results`};
    }
    async list() {
        const rows = await this.collection.find({credentialId: this.config.credentialId}).sort({created: -1}).limit(100).toArray();
        return {jobs: rows.map(row => this.status(row))};
    }
    async request(key) {
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new HttpError(404, 'Request not found');
        const row = await this.collection.findOne({credentialId: this.config.credentialId, requestKey: key});
        if (!row) throw new HttpError(404, 'Request not found');
        return this.status(row);
    }
    async submit(serviceId, form, requestKey, cache) {
        const service = Object.hasOwn(this.catalog, serviceId) ? this.catalog[serviceId] : undefined;
        if (!service) throw new HttpError(404, 'This tool is not available from the configured compute provider');
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey || '')) throw new HttpError(400, 'A valid Idempotency-Key is required');
        const inputDigest = digest(service, form, this.config.projectTag);
        const prior = await this.collection.findOne({credentialId: this.config.credentialId, requestKey});
        if (prior) {
            if (prior.digest !== inputDigest) throw new HttpError(409, 'This submission key already belongs to different inputs');
            return this.status(prior);
        }
        if (cache === 'read' || cache === 'readwrite') {
            const cached = await this.collection.findOne({credentialId: this.config.credentialId, digest: inputDigest, state: 'COMPLETED'});
            if (cached) return this.status(cached);
            if (cache === 'read') throw new HttpError(404, 'No cached result');
        }
        // Validate every parameter before storing/uploading. Translation returns
        // upload names in this pass; the second pass performs the actual uploads.
        await service.translate(form, async name => name);
        const row = {_id: randomUUID(), credentialId: this.config.credentialId, requestKey, digest: inputDigest,
            serviceId, adapterVersion: service.version, jobName: `gyde-${randomUUID()}`, state: 'SUBMITTING', created: new Date()};
        try { await this.collection.insertOne(row); }
        catch (error) {
            if (error.code !== 11000) throw error;
            return this.submit(serviceId, form, requestKey, cache);
        }
        this.active.add(row._id);
        let dispatched = false;
        try {
            const settings = await service.translate(form, (name, bytes) => this.client.upload(`${row.jobName}-${name}`, bytes));
            // Commit the dispatch intention BEFORE sending a paid request.
            await this.save(row, {state: 'RECONCILING'});
            dispatched = true;
            await this.client.submit(row.jobName, service.tool, settings);
            return this.status(await this.save(row, {state: 'PENDING'}));
        } catch (error) {
            const uncertain = dispatched && (!error.status || error.status >= 500 || error.status === 409);
            const saved = await this.save(row, {state: uncertain ? 'RECONCILING' : 'FAILED',
                message: uncertain ? 'Confirming submission with Tamarind. Do not resubmit; check the saved job name in Tamarind if this persists.' :
                    (error instanceof HttpError ? error.message : 'Input upload failed. No compute was submitted.')});
            if (uncertain) return this.status(saved);
            throw error;
        } finally { this.active.delete(row._id); }
    }
    async remote(row) {
        const remote = await this.client.job(row.jobName);
        if (!remote || remote.JobName !== row.jobName || remote.Type !== this.catalog[row.serviceId]?.tool || !remote.User ||
            (row.remoteOwner && row.remoteOwner !== remote.User))
            throw new HttpError(502, 'Tamarind returned a different job identity');
        return remote;
    }
    async poll(id) {
        let row = await this.owned(id);
        if (row.state === 'FAILED' || this.active.has(id)) return this.status(row);
        // A restart before dispatch may leave SUBMITTING. It is deliberately
        // reconciled by lookup, never by resending the submission.
        let remote;
        try { remote = await this.remote(row); }
        catch (error) {
            if (error.status === 404 && ['SUBMITTING', 'RECONCILING', 'PENDING'].includes(row.state))
                return this.status(await this.save(row, {state: 'RECONCILING', message: 'Submission has not been located yet. Do not resubmit without checking Tamarind.'}));
            throw error;
        }
        const states = {'Complete': 'COMPLETED', 'In Queue': 'PENDING', 'Pending': 'PENDING', 'Running': 'RUNNING',
            'Stopped': 'FAILED', 'Failed': 'FAILED', 'Error': 'FAILED', 'Cancelled': 'CANCELLED', 'Canceled': 'CANCELLED'};
        let state = states[remote.JobStatus];
        if (!state) throw new HttpError(502, 'Tamarind returned an unknown job state');
        row = await this.owned(id);
        if (row.cancellationRequested && remote.JobStatus === 'Stopped') state = 'CANCELLED';
        else if (row.state === 'CANCELLING' && !terminal.has(state)) state = 'CANCELLING';
        return this.status(await this.save(row, {state, remoteOwner: remote.User, message: undefined}));
    }
    async cancel(id) {
        await this.poll(id);
        const row = await this.owned(id);
        if (terminal.has(row.state)) return this.status(row);
        if (['SUBMITTING', 'RECONCILING'].includes(row.state)) throw new HttpError(409, 'Wait for submission confirmation before cancelling');
        // Persist intent before the remote write: a concurrent poll or a lost
        // response can observe Stopped before cancellation returns.
        await this.save(row, {cancellationRequested: true});
        await this.client.cancel(row.jobName);
        return this.status(await this.save(row, {state: 'CANCELLING'}));
    }
    async outputs(id) {
        const progress = await this.poll(id);
        if (progress.status !== 'COMPLETED') throw new HttpError(409, 'Results are not ready');
        const row = await this.owned(id), service = this.catalog[row.serviceId];
        if (service?.version !== row.adapterVersion) throw new HttpError(409, 'These results require their original adapter version');
        const remote = await this.remote(row);
        return {row, files: outputFiles(service.outputs, await this.client.files(remote), `${remote.User}/${remote.JobName}/`)};
    }
    async files(id) {
        const {files} = await this.outputs(id);
        return {files: files.map((file, i) => ({...file, id: `${id}/${i}`, '@content': `/compute/tamarind/media/${id}/${i}`}))};
    }
    async file(id, index) {
        if (!/^\d+$/.test(index)) throw new HttpError(404, 'File not found');
        const {row, files} = await this.outputs(id), file = files[Number(index)];
        if (!file) throw new HttpError(404, 'File not found');
        return this.client.file(row.jobName, file.path);
    }
}
