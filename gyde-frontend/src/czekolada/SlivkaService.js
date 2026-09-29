import {submitTamarind} from '../integrations/tamarind/submission';
import {isTamarindCompute} from '../compute';
import { resultRequest } from './resultRequest';
import { requestError } from "./requestErrors";
import React, {createContext, useContext, useMemo, useEffect, useReducer} from 'react';

const SlivkaServiceContext = createContext();
export {SlivkaServiceContext};

export function useSlivka() {
    const ss = useContext(SlivkaServiceContext);
    return ss;
}

export function useSlivkaService(serviceID) {
    const ss = useSlivka();
    return ss.service(serviceID);
}

function mergeServiceLists(a, b) {
    const byID = {};
    for (const bs of b) {
        byID[bs.id] = bs;
    }

    const kept = a.filter((as) => !byID[as.id] || byID[as.id].rank > as.rank);
    const keptByID = {};
    for (const bs of kept) {
        keptByID[bs.id] = bs;
    }

    return [...kept, ...b.filter((bs) => !keptByID[bs.id])];
}

export function WithSlivkaService({
    apiPrefix=['/api'],
    children
}) {
    const [ss, updateServices] = useReducer(
        (ss, {services, errors, loading}) => new SlivkaServiceWrapper(
            ss.slivkaService, 
            services ? mergeServiceLists(ss.services, services) : ss.services,
            errors ? [...ss.errors, ...errors] : ss.errors,
            loading ?? ss.loading
        ),
        [],
        () => new SlivkaServiceWrapper(new SlivkaService())
    );

    useEffect(() => {
        (async () => {
            updateServices({loading: true});
            await Promise.all(apiPrefix.map(async (url, rank) => {
                try {
                    const resp = await fetch(`${url}/services`);
                    if (!resp.ok) throw Error(`${resp.statusText}`);
                    const data = await resp.json();
                    updateServices({services: data.services.map((s) => ({...s, apiPrefix: url, rank}))});
                } catch (err) {
                    updateServices({errors: [err.message || err.toString()]});
                    console.log(err);
                }
            }));
            updateServices({loading: false});
        })();
    }, [...apiPrefix]);

    return (
        React.createElement(SlivkaServiceContext.Provider, {value: ss}, children)
    );
}

class SlivkaSubscription {
    constructor(slivkaService, jid, listener) {
        this.slivkaService = slivkaService;
        this.jid = jid;
        this.listener = listener;
    }

    unsubscribe() {
        if (!this.slivkaService) return;
        this.slivkaService.unwatchJob(this.jid, this.listener);
        this.slivkaService = undefined;
        this.listener = undefined;
    }
}


class SlivkaServiceWrapper {
    constructor(slivkaService, services=[], errors=[], loading=false) {
        this.slivkaService = slivkaService;
        this.services = services;
        this.errors = errors;
        this.loading = loading;
    }

    get error() {
        return this.errors.join('; ');
    }

    getJobStatus(jobId) {
        return this.slivkaService.status[jobId];
    }

    service(serviceID) {
        return (this.services || []).find((s) => s.id === serviceID);
    }

    submit(service, formData, options, listener) {
        const serviceObj = this.service(service);
        if (!serviceObj) return Promise.reject(new Error('This tool is not available in this deployment.'));
        return this.slivkaService.submit(service, formData, options, listener, serviceObj);
    }

    fetchRaw(jid) {
        return this.slivkaService.fetchRaw(jid);
    }

    fetch(jid, wantedFiles) {
        return this.slivkaService.fetch(jid, wantedFiles);
    }

    cancel(jid) {
        return this.slivkaService.cancel(jid);
    }

    watchJob(jid, listener, explicitURL) {
        return this.slivkaService.watchJob(jid, listener, explicitURL);
    }

    unwatchJob(jid, listener) {
        return this.slivkaService.unwatchJob(jid, listener);
    }
}


export class SlivkaService {
    constructor() {
        this.listeners = {};
        this.lastPollTimes = {};
        this.submitTimes = {};
        this.status = {};
        this.jobURLs = {};
        this.polling = new Set();

        this._poller = this._poller.bind(this);
    }

    async submit(service, formData, options, listener, serviceObj = {}) {
        options = {
            apiPrefix: serviceObj.apiPrefix,
            ...(options || {})
        };

        const now = Date.now();
        const result = await slivkaSubmit(service, formData, options);
        const jid = result['id'];
        const jobURL = result['@url'];

        if (!jid) {
            if (listener) {
                try {
                    listener(result);
                } catch (err) {}
            }
            return new SlivkaSubscription(); // dummy subscription in case someone wants to unsubscribe
        }

        this.submitTimes[jid] = this.lastPollTimes[jid] = now;
        this.status[jid] = result;
        this.jobURLs[jid] = jobURL;

        if (listener) {
            return this.watchJob(jid, listener);
        } else {
            return result;
        }
    }

    async fetchRaw(jid) {
        const response = await fetch((this.jobURLs[jid] || `/api/jobs/${jid}`) + '/files');
        if (!response.ok) throw Error(`${response.statusText}`);
        const result = await response.json();
        return result;
    }

    fetch(jid, wantedFiles) {
        const jobURL = this.jobURLs[jid] || `/api/jobs/${jid}`;
        return slivkaFetch(jobURL, wantedFiles);
    }

    async cancel(jid) {
        const jobURL = this.jobURLs[jid] || `/api/jobs/${jid}`;
        const resp = await fetch(jobURL, {method: 'DELETE'});
        if (!resp.ok) {
            throw Error(resp.statusText);
        }
    }

    watchJob(jid, listener, explicitURL) {
        if (!this.submitTimes[jid]) this.submitTimes[jid] = Date.now();
        if (!this.listeners[jid]) this.listeners[jid] = [];
        this.listeners[jid].push(listener);

        if (!this.jobURLs[jid]) {
            this.jobURLs[jid] = explicitURL || `/api/jobs/${jid}`;
        }

        if (this.status[jid]) {
            this._post(jid, listener);
        }

        this._startPoller();
        return new SlivkaSubscription(this, jid, listener);
    }

    unwatchJob(jid, listener) {
        if (this.listeners[jid]) {
            const i = this.listeners[jid].indexOf(listener);
            if (i >= 0) {
                this.listeners[jid].splice(i, 1);
            }
        }

        for (const v of Object.values(this.listeners)) {
            if (v && v.length > 0) return;
        }
        this._stopPoller();
    }   

    _post(jid, listener) {
        if (this.status[jid]) {
            try {
                listener(this.status[jid]);
                if (this.status[jid].finished) {
                    this.unwatchJob(jid, listener);
                }
            } catch (err) {
                console.log(err);
            }
        }
    }

    _postAll(jid) {
        for (const l of [...this.listeners[jid] || []]) {
            this._post(jid, l);
        }
    }

    _startPoller() {
        if (!this._timeout) {
            console.log('*** Starting compute job poller');
            this._timeout = setInterval(this._poller, 2000);
        }
    }

    _stopPoller() {
        if (this._timeout) {
            console.log('*** Stopping compute job poller');
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }
    }

    async _pollJob(jid) {
        if (this.polling.has(jid)) return;
        this.polling.add(jid);
        const jobURL = this.jobURLs[jid] || `/api/jobs/${jid}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const resp = await fetch(jobURL, {signal: controller.signal});
            if (!resp.ok) {
                throw Error(resp.statusText);
            } 
            const result = await resp.json();
            this.status[jid] = result;
            this._postAll(jid);
        } catch (err) {
            this.status[jid] = {
                finished: false,
                status: 'COMMS_ERROR',
                id: jid,
                '@url': jobURL
            }
            this._postAll(jid);
        } finally {
            clearTimeout(timeout);
            this.polling.delete(jid);
        }
    }

    _poller() {
        const now = Date.now();
        const jobPrio = [];

        for (const jid of Object.keys(this.listeners)) {
            if (!this.listeners[jid] || this.listeners[jid].length === 0) continue;
            if (this.status[jid]?.finished) continue;

            let prio;
            if (!this.lastPollTimes[jid]) {
                prio = 10000000;
            } else {
                const diff = now - this.lastPollTimes[jid],
                      past = (now - this.submitTimes[jid]) / 1000;

                const frequency = past < 60 ? 5000 : (past < 300 ? 10000 : 20000);
                if (diff < frequency) continue;

                let weight = 1;
                if (this.submitTimes[jid]) {
                    if (past > 300) {
                        weight = 0.25;
                    }
                }
                prio = diff * weight;
            }
            jobPrio.push({jid, prio});
        }
        jobPrio.sort((a, b) => b.prio - a.prio); // Descending sort, high priority == long waited time since last poll

        for (let i = 0; i < Math.min(4, jobPrio.length); ++i) {
            const jid = jobPrio[i].jid;
            this.lastPollTimes[jid] = now;
            this._pollJob(jid);
        }
    }
}


async function slivkaSubmit(serviceName, formData, options) {
    if (typeof(options) === 'boolean') {
        options = {useCache: options};
    }
    const {useCache, statusCallback, pollInterval=5000, apiPrefix='/api'} = options;

    let submitURL = `${apiPrefix}/services/${serviceName}/jobs`;
    const queryOpts = {};
    if (useCache === 'probe') {
        queryOpts['cache'] = 'read';
        if (options['probeFailures']) {
            queryOpts['cache_failures'] = 'true';
        }
    } else if (useCache) {
        queryOpts['cache'] = 'readwrite';
    }
    const queryString = Object.entries(queryOpts).map(([k, v]) => `${k}=${v}`).join('&');
    if (queryString) submitURL += ('?' + queryString);

    const resp = isTamarindCompute() ? await submitTamarind(submitURL, formData) : await fetch(submitURL, {
        method: 'POST', body: formData
    });
    if (!resp.ok) {
        if (resp.status === 404 && useCache === 'probe') {
            return {status: 'NOT_FOUND'};
        }
        throw Error(await requestError(resp));
    }
    let result = await resp.json();
    return result;
}

async function slivkaFetch(statusUrl, wantedFiles) {
    const fileRequests = wantedFiles.map((req) => {
        if (typeof(req) === 'string') {
            return {
                label: req,
                required: true,
                type: 'text',
                found: false
            };
        } else {
            return {
                required: true,
                type: 'text',
                ...req,
                found: false
            }
        }
    });

    const result = await resultRequest(`${statusUrl}/files`);

    const filePromises = [];
    for (const file of result.files) {
        const fileRequest = fileRequests.filter((w) => w.label === file.label)[0];
        if (fileRequest) {
            filePromises.push(async () => {
                if (fileRequest.type === 'uri' || fileRequest.type === 'url') {
                    return {
                        label: fileRequest.label,
                        path: file.path,
                        data: file['@content']
                    };
                } else if (fileRequest.type === 'id') {
                    return {
                        label: fileRequest.label,
                        path: file.path,
                        data: file['id']
                    }
                }

                const data = await resultRequest(file['@content'], fileRequest.type || 'text');
                return {
                    label: fileRequest.label,
                    path: file.path,
                    data: data
                };
            });
            fileRequest.found = true;
        }
    }

    const missing = fileRequests.filter(({required, found}) => required && !found);
    if (missing.length > 0) {
        throw Error(`Missing response(s) with labels ${missing.map(({label}) => label).join(',')}`);
    }

    return Promise.all(filePromises.map((p) => p()));
}
