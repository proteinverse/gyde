#! /usr/bin/env node

import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import {gunzip, gzip} from 'zlib';

import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import cors from 'cors';
import proxy from 'http-proxy-middleware';
import compression from 'compression'

import * as uuid from 'uuid';
import {MongoClient} from 'mongodb';
import multiparty from 'multiparty';
import fetch, {FormData, File, fileFromSync} from 'node-fetch';
import {Blob} from 'fetch-blob';
import {createHash as createHashSHA256} from 'sha256-uint8array';

import {translateDNA} from './sequence.js';

import OIDC from 'express-openid-connect';
import {computeConfig, personalAccess} from './integrations/tamarind/config.js';
const compute = computeConfig();

const {requiresAuth, auth} = OIDC;


const PORT = parseInt(process.env.GYDE_PORT || '3030');
const TLS_PORT = process.env.GYDE_TLS_PORT ? parseInt(process.env.GYDE_TLS_PORT) : undefined;
const HOST = process.env.GYDE_HOST || '127.0.0.1';
const SLIVKA = process.env.GYDE_SLIVKA_URL;
if (!SLIVKA && compute.provider === 'slivka') {
    throw Error('You must specify GYDE_SLIVKA_URL');
}
const SLIVKA2 = process.env.GYDE_SLIVKA2_URL || SLIVKA;
const MOCK_USER = process.env.GYDE_MOCK_USER;
const MONGO_CONNECTION = process.env.GYDE_MONGO_CONNECTION || 'mongodb://localhost/';


const STATIC_DIR = process.env.GYDE_STATIC_DIR || '../gyde-frontend/build';


const ENV = process.env.GYDE_ENV || (PORT >= 3031  && PORT <= 3039) ? 'dev' : 'prod';

const DB_NAME = process.env.GYDE_DB_NAME
    || (ENV === 'dev' ? 'gydedb_dev' : 'gydedb_prd');
const SESSION_COLLECTION_NAME = process.env.GYDE_SESSION_COLLECTION 
    || (ENV === 'dev' ? 'gyst_sessions_dev' : 'gyde_sessions');
const COLUMN_DATA_COLLECTION_NAME = process.env.GYDE_COLUMN_DATA_COLLECTION 
    || (ENV === 'dev' ? 'gyst_columns_dev' : 'gyde_columns');
const LOGIN_COLLECTION_NAME = process.env.GYDE_LOGIN_COLLECTION 
    || (ENV === 'dev' ? 'gyst_login_dev' : 'gyde_login');
const CACHE_COLLECTION_NAME = process.env.GYDE_CACHE_COLLECTION 
    || (ENV === 'dev' ? 'gyde_jobcache_v2_dev' : 'gyde_jobcache_v2');
const ACTION_COLLECTION_NAME = process.env.GYDE_ACTION_COLLECTION 
    || (ENV === 'dev' ? 'gyst_actions_dev' : 'gyde_actions');
const OPEN_COLLECTION_NAME = process.env.OPEN_ACTION_COLLECTION 
    || (ENV === 'dev' ? 'gyst_open_log_dev' : 'gyde_open_log');

const FEATURE_FLAGS_DEFAULT = {
    boltz: true,
    chai: true,
    boltz1x: true,
    boltz2: true,
    chaiLab: true,
    of3: true,
    of3v1: false,
    ibex: false,

    ligandMPNN: true,

    useCaseHelp: true
};
const FEATURE_FLAGS_DEV = {
    boltz: true,
    chai: true,
    boltz1x: true,
    boltz2: true,
    chaiLab: true,
    of3: true,
    of3v1: true,
    ibex: true,

    ligandMPNN: true,

    useCaseHelp: true
};


let GYDESRV_PLUGIN = {};

const mongo = new MongoClient(MONGO_CONNECTION);
const mongodb = mongo.db(DB_NAME);
const sessionCollection = mongodb.collection(SESSION_COLLECTION_NAME);
const columnDataCollection = mongodb.collection(COLUMN_DATA_COLLECTION_NAME);
const loginCollection = mongodb.collection(LOGIN_COLLECTION_NAME);
const cacheCollection = mongodb.collection(CACHE_COLLECTION_NAME);
const actionCollection = mongodb.collection(ACTION_COLLECTION_NAME);
const openLogCollection = mongodb.collection(OPEN_COLLECTION_NAME);


const app = express();
if (compute.provider === 'tamarind') app.use(personalAccess(compute));
app.get('/compute/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({provider: compute.provider});
});
const memoryStore = new session.MemoryStore();


app.use(compression());

app.use(
    session({
        secret: 'skdjfshgdhfjsd1912lacsn',
        resave: false,
        saveUninitialized: true,
        store: memoryStore
    })
);

let protect, protectGRED, protectLogs;
protectGRED = protectLogs = (req, res, next) => {
    next();
}

let getSessionAccessScope = (req) => {
    return 'other';
}

if (!MOCK_USER) {
    let baseURL = process.env.GYDE_OAUTH_BASE_URL;
    if (!baseURL) {
        if (TLS_PORT) {
            baseURL = 'https://';
        } else {
            baseURL = 'http://';
        }

        if (HOST === '0.0.0.0') {
            baseURL += process.env.HOSTNAME;
        } else {
            baseURL += HOST;
        }

        if (TLS_PORT) {
            baseURL += ':' + TLS_PORT;
        } else {
            baseURL += ':' + PORT;
        }
    }

    app.use(auth({
        issuerBaseURL: process.env.GYDE_OAUTH_ISSUER,
        afterCallback: async (req, res, tokenSet, decodedState) => {
            if (tokenSet.id_token) {
                const tokenContent = JSON.parse(Buffer.from(tokenSet.id_token.split('.')[1], 'base64').toString());
                const timestamp = new Date().toISOString();
                await loginCollection.insertOne({user: tokenContent.preferred_username, name: tokenContent.name, timestamp, _gyde_groups: tokenContent.groups});
            }
            return tokenSet;
        },
        baseURL,
        routes: {
            callback: '/callback'
        },
        authorizationParams: {
          response_type: 'code',
          scope: 'openid'
        },
        clientID: process.env.GYDE_OAUTH_CLIENT,
        clientSecret: process.env.GYDE_OAUTH_SECRET,
        secret: 'as;dash8gsuofgs`udgfbh`spf98wf`sfduygbfsydogfsyugfyuo`sfag7wgg7hzvdslvibzffuhggbxbzjlhwa',

        authRequired: false
    }));

    protect = requiresAuth();
} else {
    protect = (req, res, next) => {
        next();
    }
}

await (async () => {
    try {
        GYDESRV_PLUGIN = await import(process.cwd() + '/gydesrv_plugin.js');
        if (GYDESRV_PLUGIN?.default) {
            console.log('Using plugin');
            GYDESRV_PLUGIN.default(app, protect, protectGRED);
        }

        if (GYDESRV_PLUGIN?.logAccessController) {
            protectLogs = GYDESRV_PLUGIN.logAccessController;
        }
        if (GYDESRV_PLUGIN?.getSessionAccessScope) {
            getSessionAccessScope = GYDESRV_PLUGIN.getSessionAccessScope;
        }
    } catch (err) {
        if (err?.code === 'ERR_MODULE_NOT_FOUND') {
            console.log('No plugin provided');
        } else {
            throw err;
        }
    }
})();

app.get(
    '/special/user-log',
    protect,
    protectLogs,
    async (req, res) => {
        const logRecords = [['username', 'name', 'login_time'].join('\t')];
        for await (const session of loginCollection.find({})) {
            logRecords.push([session.user, session.name, session.timestamp ?? ''].join('\t'));
        }

        res.set({
            'content-type': 'text/tab-separated-values',
            'content-disposition': 'attachment; filename="gyde-users.tsv'
        }).send(logRecords.join('\n'));
        return;
    }
);

app.post(
    '/ping',
    bodyParser.json(),
    async (req, res) => {
        const user = getUser(req);
        const timestamp = new Date().toISOString();
        await actionCollection.insertOne({user: user.username, type: req.body.action || 'unknown', detail: req.body.detail, time: timestamp});
        res.send('OK');
    }
);

app.get(
    '/special/action-log',
    protect,
    protectLogs,
    async (req, res) => {
        const logRecords = [['username', 'time', 'action'].join('\t')];
        for await (const record of actionCollection.find({})) {
            logRecords.push([record.user, record.time ?? '', record.type].join('\t'));
        }

        res.set({
            'content-type': 'text/tab-separated-values',
            'content-disposition': 'attachment; filename="gyde-actions.tsv'
        }).send(logRecords.join('\n'));
    }
);

app.get(
    '/special/session-list',
    protectLogs,
    async (req, res) => {
        const logRecords = [['timestamp', 'user', 'name'].join('\t')];
        for await (const record of sessionCollection.find({}, {projection: {created: 1, user: 1, user_name: 1}})) {
            logRecords.push([record.created, record.user, record.user_name].join('\t'));
        }

        res.set({
            'content-type': 'text/tab-separated-values',
            'content-disposition': 'attachment; filename="gyde-sessions.tsv'
        }).send(logRecords.join('\n'));
    }
);

app.get('/environment', (req, res) => {
    let environment = {
        type: ENV,
        featureFlags: ENV === 'dev' ? FEATURE_FLAGS_DEV : FEATURE_FLAGS_DEFAULT
    };

    if (GYDESRV_PLUGIN.environment) {
        environment = GYDESRV_PLUGIN.environment(environment);
    }

    res.type('json').send(JSON.stringify(environment));
});



function getUser(req) {
    const info = {};
    if (req.oidc && req.oidc.user) {
        const user = req.oidc.user;

        info.name = user.name;
        info.username = user.preferred_username;
        info.roles = user.groups ?? [];
    } else if (MOCK_USER) {
        info.name = info.username = MOCK_USER;
        info.roles = [];
    }
    return info
}

app.get('/user-info', 
    protect,
    (req, res) => {
    const info = getUser(req);
    res.type('json').send(JSON.stringify(info));
});

app.get('/token',
    protect,
    async (req, res) => {
        if (req.oidc && req.oidc.accessToken?.isExpired()) {
            await req.oidc.accessToken.refresh();
        }

        if (req.oidc && req.oidc.accessToken) {
           res.type('json').send(JSON.stringify({'token': req.oidc.accessToken.access_token}));
        } else {
           res.type('json').send('{}');
        }
    }
);

function gzipP(data) {
    return new Promise((resolve, reject) => {
        gzip(data, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        })
    });
}

function gunzipP(data) {
    return new Promise((resolve, reject) => {
        gunzip(data, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        })
    });
}

async function compressColumn(data) {
    const colData = JSON.stringify(data);
    if (colData.length < 100000) {
        return {data};
    } else {
        const compressed = await gzipP(colData);
        return {data: compressed, format: 'gzip'}
    }
}

async function decodeColumn(column) {
    if (column.format == 'gzip') {
        const raw = await gunzipP(column.data.buffer);
        return JSON.parse(raw.toString());
    } else {
        return column.data;
    }
}

app.get(
    '/store',
    protect,
    async (req, resp) => {
        const user = getUser(req),
              scope = getSessionAccessScope(req);
        const response = [];

        const openTimes = {};
        for await (const doc of openLogCollection.find({user: user.username})) {
            openTimes[doc.sessionId] = doc.openTime;
        }

        for await (const doc of sessionCollection.find({
                '$and': [
                    {
                        '$or': [
                            {user: user.username},
                            {shared: true}
                        ]
                    },
                    {
                        '$or': [
                            {scope: scope},
                            {scope: {'$exists': false}}
                        ]
                    },
                    {
                        _deleted: {'$ne': true}
                    }
                ]
            },
            {projection: {_id: 0, id: 1, lastModified: 1, created: 1, name: 1, shared: 1, public: 1, user: 1, user_name: 1, description: 1}})
        ) {
            const docUser = doc.user || '';
            if (docUser !== user.username) {
                doc['_gyde_readonly'] = true;
            }
            if (doc.public || doc.user === user.username || openTimes[doc.id]) {
                response.push({...doc, openTime: openTimes[doc.id]});
            }
        }

        resp.type('json').send(JSON.stringify(response))
    }
);


async function saveColumarSession(body, user, scope) {
    const id = uuid.v4();
    const timestamp = new Date().toISOString();

    body = {...body};
    const columnarData = body.columnarData || {};
    body.columnarData = {};

    const session = mongo.startSession();
    try {
        session.startTransaction();
        const insert = {
            ...body,
            id: id,
            user: user.username,
            user_name: user.name,
            created: timestamp,
            lastModified: timestamp
        }
        if (scope) {
            insert.scope = scope;
        }
        await sessionCollection.insertOne(insert, {session});

        const entries = await Promise.all(Object.entries(columnarData).map(async ([key, data]) => {
            const colData = await compressColumn(data);
            return {sessionId: id, columnName: key, ...colData}
        }));

        await columnDataCollection.insertMany(
            entries,
            {session}
        );

        await session.commitTransaction();
    } finally {
        await session.endSession();
    }

    return {id, timestamp};
}

app.post(
    '/store',
    protect,
    bodyParser.json({inflate: true, limit: '500mb'}),
    async (req, resp) => { 
        const user = getUser(req),
              scope = getSessionAccessScope(req);

        const body = {...req.body};
        delete body['_gyde_readonly'];

        try {
            const {id, timestamp} = await saveColumarSession(body, user, scope);
            resp.type('json').send(JSON.stringify({'id': id, timestamp}));
        } catch (err) {
            console.log(err);
            resp.status(500).send('' + (err.message || err));
        }        
    }
);


app.post(
    '/store/:id',
    protect,
    bodyParser.json({inflate: true, limit: '500mb'}),
    async (req, resp) => {
        const id = req.params.id;
        const user = getUser(req);
        const timestamp = new Date().toISOString();
        const body = {
             ...req.body, lastModified: timestamp
        }
        delete body['_gyde_readonly'];
        delete body['user'];
        delete body['user_name'];
        delete body['scope'];
        delete body['openTime'];

        const columnarData = body.columnarData;
        delete body.columnarData;

        // FIXME Temporary solution until we change storage for columnar data.
        // [potentially raceable...]
        if (body.encodedBlobColumns || body.objColumns) {
            const doc = await sessionCollection.findOne({id: id, user: user.username});
            if (!doc) {
                resp.status(404).send('not found');
                return;
            }
            body.encodedBlobColumns = {...doc.encodedBlobColumns, ...body.encodedBlobColumns};
            body.objColumns = {...doc.objColumns, ...body.objColumns};
        }

        let result;
        const session = mongo.startSession();
        try {
            session.startTransaction();
            result = await sessionCollection.updateOne(
                {id: id, user: user.username},
                {'$set': {...body, user_name: user.name, lastModified: timestamp}},
                {session}
            );

            if (result.matchedCount && columnarData) {
                const promises = Object.entries(columnarData).map(async ([key, data]) => {
                    const colData = await compressColumn(data);
                    return columnDataCollection.updateOne(
                        {sessionId: id, columnName: key},
                        {'$set': {sessionId: id, columnName: key, ...colData}},
                        {session, upsert: true}
                    )
                });
                if (promises.length) {
                    await Promise.all(promises);
                }
            }

            await session.commitTransaction();

            if (!result.matchedCount) {
                resp.status(404).send('not found');
            } else {
                resp.type('json').send('{"status": "OK"}');
            }
        } catch (err) {
            console.log(err);
            resp.status(500).send('' + (err.message || err));
            await session.abortTransaction();
        } finally {
            await session.endSession();
        }
    }
);


app.get(
    '/store/:id',
    protect,
    async (req, resp) => {
        const id = req.params.id;
        const user = getUser(req),
              scope = getSessionAccessScope(req);

        const doc = await sessionCollection.findOne({
            '$and': [
                {
                    '$or': [
                        {user: user.username},
                        {shared: true}
                    ]
                },
                {
                    '$or': [
                        {scope: scope},
                        {scope: {'$exists': false}}
                    ]
                },
                {
                    id: id,
                    _deleted: {'$ne': true}
                }
            ]
        });
        if (!doc) {
            resp.status(404).send('not found');
        } else {
            delete doc['id'];
            delete doc['_id'];
            delete doc['shared'];
            delete doc['public'];
            if (doc.user && doc.user != user.username) {
                doc['_gyde_readonly'] = true;
            }

            for await (const col of columnDataCollection.find({sessionId: id})) {
                const data = await decodeColumn(col)
                if (!doc.columnarData) doc.columnarData = {};
                doc.columnarData[col.columnName] = data;
            }

            resp.type('json').send(JSON.stringify(doc));

            const timestamp = new Date().toISOString();
            return openLogCollection.updateOne(
                {sessionId: id, user: user.username},
                {'$set': {sessionId: id, user: user.username, openTime: timestamp}},
                {upsert: true}
            )
        }
    }
);

app.delete(
    '/store/:id',
    protect,
    async (req, resp) => {
        const id = req.params.id;
        const user = getUser(req);

        const doc = await sessionCollection.findOne({user: user.username, id: id});
        if (!doc) {
            resp.status(404).send('not found');
        }
        await sessionCollection.updateOne({id: id, user: user.username}, {'$set': {_deleted: true}})

        resp.type('json').send('{"status": "OK"}')
    }
)

app.options(
    '/send-to-gyde'
);

app.post(
    '/send-to-gyde',
    (req, res, next) => {
        const formParser = new multiparty.Form();
        formParser.parse(req, async (err, fields, files) => {
            const file = ((files || {})['session_data'] || [])[0];
            if (!file) {
                res.send('no data');
                return;
            }
            req.session.s2g_path = file.path;
            res.redirect('/send-to-gyde')
            // next();
        });
    }
);

app.get(
     '/send-to-gyde',
     protect,
     (req, resp) => {
        console.log('redirected');
        sendToGydeBottomHalf(req, resp);
     }
);

async function sendToGydeBottomHalf(req, resp) {
    if (!req.session.s2g_path) {
        resp.send('no stored data');
        return;
    }

    const data = JSON.parse(fs.readFileSync(req.session.s2g_path, 'utf8'));
    req.session.s2g_path = undefined;

    const user = getUser(req);
    let body = {...data};
    delete body['_gyde_readonly'];

    if (body.data) {
        body = promoteV1000(body);
    } else if (body.columnarData) {
        body._gyde_format_version = 100000;
    } else {
        resp.send('bad format')
        return;
    }

    try {
        const {id} = await saveColumarSession(body, user);
        resp.redirect(`/?load_session=${id}`);
    } catch (err) {
        console.log(err);
        resp.status(500).send('' + (err.message || err));
        return;
    }    
}



//
// Slivka caching: alternative versions of certain Slivka endpoints to enable job-caching.
// Remaining Slivka requests fall through to the /api and /media proxies below.
//

async function getCacheForDigest(key, slivkaURL) {
    try {
        const results = [];
        for await (const doc of cacheCollection.find({slivkaBase: slivkaURL, digest: key})) {
            results.push(doc.slivkaResponse);
        }
        return results;
    } catch (err) {
        console.log(err);
        return [];
    }
}

async function digest(data) {
    //const hash = await window.crypto.subtle.digest('SHA-256', data);
    const hash = createHashSHA256().update(data).digest();
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function requestDigest(formData) {
    const pieces = [];
    for (const [k, v] of formData.entries()) {
        if (v instanceof File) {
            const blobData = await v.arrayBuffer();
            const blobHash = await digest(new Uint8Array(blobData));
            pieces.push(k, blobHash);
        } else {
            pieces.push(k, v);
        }
    }

    const hash = await digest(new TextEncoder().encode(pieces.join(':')));
    return hash;
}

if (compute.provider === 'tamarind') {
    const {tamarindRouter} = await import('./integrations/tamarind/router.js');
    app.use(await tamarindRouter({config: compute, collection: mongodb.collection('gyde_tamarind_jobs')}));
}

app.post(
    '/api/services/:service/jobs',
    (req, res, next) => {
        return cachingProxyJobSubmission(SLIVKA, '/api', req, res, next);
    }
);

app.post(
    '/api2/services/:service/jobs',
    (req, res, next) => {
        return cachingProxyJobSubmission(SLIVKA2, '/api2', req, res, next);
    }
);

function postToFormData(req) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        const formParser = new multiparty.Form();
        formParser.on('error', (err) => {
            reject(err.toString());
        });
        formParser.on('file', (name, file) => {
            let data = fileFromSync(file.path);
            if (data.size === 0) data = new Blob([]);
            formData.append(name, data, file.originalFilename);
        });
        formParser.on('field', (field, value) => {
            formData.append(field, value);
        });
        formParser.on('close',  () => {
            resolve(formData);
        });

        formParser.parse(req);
    });
}

async function cachingProxyJobSubmission(slivkaURL, apiPrefix, req, res, next) {
    const service = req.params.service;

    const cacheMode = (req.query.cache || 'none').toLowerCase();
    if (cacheMode !== 'none' && cacheMode !== 'write' && cacheMode !== 'readwrite' && cacheMode !== 'read') {
        res.status(400).send('Bad cache mode: ' + cacheMode);
    }
    const failMode = ((req.query.cache_failures || 'false').toLowerCase() === 'true');

    try {
        const formData = await postToFormData(req);
        return doCachingProxyJobSubmission(slivkaURL, apiPrefix, service, formData, cacheMode, failMode, res);
    } catch (err) {
        console.log(err);
        res.status(500).send(err.toString());
    }
}

async function doCachingProxyJobSubmission(slivkaURL, apiPrefix, service, formData, cacheMode, failMode, res) {
    try {
        const digest = await requestDigest(formData);
        const key = service + '-' + digest;

        if (cacheMode === 'readwrite' || cacheMode === 'read') {
            const cache = await getCacheForDigest(key, slivkaURL);
            const hits = cache.filter((j) => j.status === 'COMPLETED');
            if (hits.length > 0) {
                const cachedResult = hits[hits.length - 1];
                cachedResult['@url'] = cachedResult['@url'].replace(/^\/api/, apiPrefix);
                res.type('json').send(JSON.stringify(cachedResult));
                return;
            }
            const inProgress = cache.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING' || j.status === 'PENDING');
            if (inProgress.length > 0) {
                const cachedResult = inProgress[inProgress.length - 1];
                cachedResult['@url'] = cachedResult['@url'].replace(/^\/api/, apiPrefix);
                res.type('json').send(JSON.stringify(cachedResult));
                return;
            }
            if (failMode) {
                const fails = cache.filter((j) => j.status === 'FAILED');
                if (fails.length > 0) {
                    const cachedResult = fails[fails.length - 1];
                    cachedResult['@url'] = cachedResult['@url'].replace(/^\/api/, apiPrefix);
                    res.type('json').send(JSON.stringify(cachedResult));
                    return;
                }
            }
            if (cacheMode === 'read') {
                res.status(404).send('Not found');
                return;
            }
        }

        const slivkaResp = await fetch(`${slivkaURL}/api/services/${service}/jobs`, {
            method: 'POST',
            body: formData
        })
        if (!slivkaResp.ok) {
            const slivkaFailMessage = await slivkaResp.text();
            res.status(slivkaResp.status).type(slivkaResp.headers['content-type'] || 'json').send(slivkaFailMessage);
            return;
        }
        const slivkaResult = await slivkaResp.json();
        try {
            await cacheCollection.insertOne({
                slivkaBase: slivkaURL,
                digest: key,
                jobID: slivkaResult.id,
                slivkaResponse: slivkaResult,
                timestamp: Date.now()
            });
        } catch (err) {
            console.log(err);
        }
        slivkaResult['@url'] = slivkaResult['@url'].replace(/^\/api/, apiPrefix);
        res.type('json').send(JSON.stringify(slivkaResult));
     } catch (err) {
        console.log(err);
        res.status(500).send(err.toString());
    }
}

app.get(
    '/api/jobs/:jid',
    async (req, res) => {
        return cachingProxyJobQuery(SLIVKA, '/api', req, res);
    }
)

app.get(
    '/api2/jobs/:jid',
    async (req, res) => {
        return cachingProxyJobQuery(SLIVKA2, '/api2', req, res);
    }
)

async function cachingProxyJobQuery(slivkaURL, apiPrefix, req, res) {
    const jid = req.params.jid;

    try {
        const slivkaResp = await fetch(`${slivkaURL}/api/jobs/${jid}`);
        if (slivkaResp.ok) {
            const slivkaResult = await slivkaResp.json();
            try {
                await cacheCollection.updateOne({jobID: jid}, {'$set': {slivkaResponse: slivkaResult, timestamp: Date.now()}});
            } catch (err) {
                console.log(err);
            }
            slivkaResult['@url'] = slivkaResult['@url'].replace(/^\/api/, apiPrefix);
            res.status(slivkaResp.status).type('json').send(JSON.stringify(slivkaResult));
        } else {
            const slivkaOut = await slivkaResp.text();
            res.status(slivkaResp.status).send(slivkaOut);
        }
    } catch (err) {
        console.log(err);
        res.status(500).send('error');
    }
}

app.delete(
    '/api/jobs/:jid',
    async (req, res) => {
        return proxyJobCancel(SLIVKA, req, res);
    }
)

app.delete(
    '/api2/jobs/:jid',
    async (req, res) => {
        return proxyJobCancel(SLIVKA2, req, res);
    }
)

async function proxyJobCancel(slivkaURL, req, res) {
    const jid = req.params.jid;
    try {
        const slivkaResp = await fetch(`${slivkaURL}/api/jobs/${jid}`, {method: 'DELETE'});
        if (slivkaResp.ok) {
            res.status(200).type('json').send(JSON.stringify({status: 'cancelled', id: jid}));
        } else {
            const slivkaOut = await slivkaResp.text();
            res.status(slivkaResp.status).send(slivkaOut);
        }
    } catch (err) {
        console.log('Job cancel error:', err);
        res.status(500).send('error cancelling job');
    }
}

app.get(
    '/api/jobs/:jid/files',
    async (req, res) => {
        return cachingProxyJobFilesQuery(SLIVKA, '/api', '/media', req, res);
    }
)

app.get(
    '/api2/jobs/:jid/files',
    async (req, res) => {
        return cachingProxyJobFilesQuery(SLIVKA2, '/api2', '/media2', req, res);
    }
)

async function cachingProxyJobFilesQuery(slivkaURL, apiPrefix, mediaPrefix, req, res) {
    const jid = req.params.jid;

    try {
        const slivkaResp = await fetch(`${slivkaURL}/api/jobs/${jid}/files`);
        if (slivkaResp.ok) {
            const slivkaResult = await slivkaResp.json();
            slivkaResult.files = slivkaResult.files.map((f) => ({
                ...f,
                '@content': f['@content'].replace(/^\/media/, mediaPrefix),
                '@url': f['@url'].replace(/^\/api/, apiPrefix)
            }));
            res.status(slivkaResp.status).type('json').send(JSON.stringify(slivkaResult));
        } else {
            const slivkaOut = await slivkaResp.text();
            res.status(slivkaResp.status).send(slivkaOut);
        }
    } catch (err) {
        console.log(err);
        res.status(500).send('error');
    }
}


app.get(
    '/api/job-cache/:service/:digest',
    async (req, res) => {
        return cachingProxyJobProbe(SLIVKA, '/api', req, res);
    }
);
app.get(
    '/api2/job-cache/:service/:digest',
    async (req, res) => {
        return cachingProxyJobProbe(SLIVKA2, '/api2', req, res);
    }
);

async function cachingProxyJobProbe(slivkaURL, apiPrefix, req, res) {
    try {
        const digest = req.params.digest;
        const service = req.params.service;
        const key = service + '-' + digest;
        const entries = await getCacheForDigest(key, slivkaURL);

        const completed = entries.filter((j) => j.status === 'COMPLETED');
        if (completed.length > 0) {
            const cachedResult = completed[completed.length - 1];
            cachedResult['@url'] = cachedResult['@url'].replace(/^\/api/, apiPrefix);
            res.type('json').send(JSON.stringify(cachedResult));
            return;
        }

        const inProgress = entries.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING' || j.status === 'PENDING');
        if (inProgress.length > 0) {
            const cachedResult = inProgress[inProgress.length - 1];
            cachedResult['@url'] = cachedResult['@url'].replace(/^\/api/, apiPrefix);
            res.type('json').send(JSON.stringify(cachedResult));
            return;
        }

        res.status(404).send('no match');
    } catch (err) {
        console.log(err);
        res.status(500).send('error');
    }
}

function translateAndTrim(s) {
    let tl = translateDNA(s || '');
    if (tl.length > 0 && tl[tl.length-1] === '*') tl = tl.substring(0, tl.length-1);
    return tl;
}

app.post(
    '/api/dna-analyses/abodybuilder',
    async (req, res) => {
        try {
            const reqFormData = await postToFormData(req);
            const heavyDna = reqFormData.get('heavy'),
                  lightDna = reqFormData.get('light');

            if (!heavyDna || !lightDna) {
                res.status(422).send('require "heavy" and "light" sequences');
                return;
            }

            const formData = new FormData();
            formData.append('heavy', translateAndTrim(heavyDna));
            formData.append('light', translateAndTrim(lightDna));
            formData.append('target_name', 'predicted');
            formData.append('renumber', 'kabat');

            doCachingProxyJobSubmission(SLIVKA, '/api', 'abodybuilder', formData, 'readwrite', false, res);
        } catch (err) {
            console.log(err);
            res.status(500).send(err.toString);
        }
    }
);

if (compute.provider === 'slivka') {
app.use(
    '/api',
    proxy.createProxyMiddleware({
        target: SLIVKA,
        changeOrigin: true
    })
);
app.use(
    '/media',
    proxy.createProxyMiddleware({
        target: SLIVKA,
        changeOrigin: true
    })
);


app.use(
    '/api2',
    proxy.createProxyMiddleware({
        target: SLIVKA2,
        pathRewrite: {'^/api2': '/api'},
        changeOrigin: true
    })
);
app.use(
    '/media2',
    proxy.createProxyMiddleware({
        target: SLIVKA2,
        pathRewrite: {'^/media2': '/media'},
        changeOrigin: true
    })
);


}

app.use(protect, express.static(STATIC_DIR));
const defaultSPARoute = [
    protect,
    (req, res) => {
        res.sendFile(path.resolve(STATIC_DIR, 'index.html'))
    }
];
app.get('/new', ...defaultSPARoute)
app.get('/new/*', ...defaultSPARoute)
app.get('/datasets', ...defaultSPARoute);
app.get('/dataset/*', ...defaultSPARoute);



if (TLS_PORT) {
    https.createServer({
        cert: fs.readFileSync('cert.pem'),
        key: fs.readFileSync('cert.key.pem')
    }, app).listen(TLS_PORT);

    const bouncer = express();
    bouncer.use(
        session({
            secret: 'skdjfshgdhfjsd1912lacsn',
            resave: false,
            saveUninitialized: true,
            store: memoryStore
        })
    );
    bouncer.get('*', (req, res) => {
        res.redirect('https://' + req.hostname + ':' + TLS_PORT + req.url);
    });

    bouncer.post(
        '/send-to-gyde',
        (req, res, next) => {
            const formParser = new multiparty.Form();
            formParser.parse(req, async (err, fields, files) => {
                const file = ((files || {})['session_data'] || [])[0];
                if (!file) {
                    resp.send('no data');
                    return;
                }
                req.session.s2g_path = file.path;
                next();
            });
        },
        (req, resp) => {
            resp.redirect('https://' + req.hostname + ':' + TLS_PORT + req.url);
        }
    );
    bouncer.listen(PORT, HOST);
} else {
    app.listen(PORT, HOST, () => {
        console.log(`GYDE server listening on ${HOST}:${PORT}`);
    });
}

async function orphanJobPoller() {
    const orphan = await cacheCollection.findOne({
        'slivkaResponse.finished': false,
        timestamp: {'$lt': Date.now() - 15000},
        '$or': [
            {pollErrors: {'$exists': false}},
            {pollErrors: {'$lt': 5}}
        ]
    });
    if (orphan) {
        const slivkaURL = orphan.slivkaBase || SLIVKA;

        try {
            const slivkaResp = await fetch(`${slivkaURL}/api/jobs/${orphan.jobID}`);
            if (slivkaResp.ok) {
                const slivkaResult = await slivkaResp.json();
                try {
                    await cacheCollection.updateOne(
                        {jobID: orphan.jobID},
                        {'$set': {
                            slivkaResponse: slivkaResult,
                            timestamp: Date.now(),
                            pollErrors: 0
                        }}
                    );
                } catch (err) {
                    console.log(err);
                }
            } else {
                try {
                    await cacheCollection.updateOne(
                        {jobID: orphan.jobID},
                        {'$set': {
                            timestamp: Date.now(),
                            pollErrors: (orphan.pollErrors || 0) + 1
                        }}
                    );
                } catch (err) {
                    console.log(err);
                }
            }
        } catch (err) {
            console.log(err);
        }
    }
    setTimeout(orphanJobPoller, 2000);
}

setTimeout(orphanJobPoller, 2000);


//
// SOA promotion logic
//

function promoteV1000(postData) {
    const {
        data,
        dataColumns,
        alignedHeavy, alignedHeavyRN,
        alignedLight, alignedLightRN,
        anarciHeavy, anarciHeavyRN,
        anarciLight, anarciLightRN,
        selection,
        heavySelectedColumns,
        lightSelectedColumns,
        filter,
        encodedBlobs,
        ...sessionProps
    } = postData;

    data.columns = dataColumns;
    if (alignedHeavy) alignedHeavy.residueNumbers = alignedHeavyRN;
    if (alignedLight) alignedLight.residueNumbers = alignedLightRN;
    if (anarciHeavy) anarciHeavy.residueNumbers = anarciHeavyRN;
    if (anarciLight) anarciLight.residueNumbers = anarciLightRN;

    /* We don't support encoded blobs for s2g at the moment.
    const blobCache = (encodedBlobs || []).map(({data, type}) => {
        const props = {};
        if (type) props.type = type;
        return new Blob([toByteArray(data).buffer], props);
    });

    for (const d of data) {
        for (const [k, v] of Object.entries(d)) {
            if (v && v._gyde_blob_) {
                if (typeof(v._gyde_blob_.index) === 'number') {
                    d[k] = blobCache[v._gyde_blob_.index];
                } else {
                    const props = {};
                    if (v._gyde_blob_.type) props.type = v._gyde_blob_.type;
                    d[k] = new Blob([toByteArray(v._gyde_blob_.data).buffer], props);
                }
            }
        }
    }
    */

    if (!sessionProps.seqColumns) {
        sessionProps.seqColumns = [];
        if (data.columns.indexOf('HC_sequence') >= 0) sessionProps.seqColumns.push('HC_sequence');
        if (data.columns.indexOf('LC_sequence') >= 0) sessionProps.seqColumns.push('LC_sequence');
    }

    const columnarData = aosToSoaInclusive(data);

    if ((sessionProps.dataFields || []).indexOf('Names') < 0) {
        sessionProps.dataFields = ['Names', ...(sessionProps.dataFields || [])];
    }

    if ((sessionProps.msaDataFields || []).indexOf('Names') < 0) {
        sessionProps.msaDataFields = ['Names', ...(sessionProps.msaDataFields || [])];
    }

    if (!sessionProps.seqColumns) {
        sessionProps.seqColumns = [];
        if (columnarData['HC_sequence']) sessionProps.seqColumns.push('HC_sequence');
        if (columnarData['LC_sequence']) sessionProps.seqColumns.push('LC_sequence');
    }
    sessionProps.seqColumns = sessionProps.seqColumns.map((column) => ((column instanceof String) ? ({column}) : column));

    if (alignedLight || alignedHeavy) {
        sessionProps.msaColumns = sessionProps.seqColumns.map(({column}) => {
            let align = null;
            if (column === 'HC_sequence') align = alignedHeavy;
            if (column === 'LC_sequence') align = alignedLight;
            if (align) {
                const msaColName = '_gyde_msa_' + column;
                columnarData[msaColName] = align.map(({seq}) => seq);
                return {
                    column: msaColName,
                    numbering: align.residueNumbers
                };
            }
        });
    }

    return {
        ...sessionProps,
        storedAlignment: null,    // We always want to re-run numbering alignments on Ab datasets.
        columnarData,
        dataColumns,
        dataRowCount: data.length,
        _gyde_format_version: 100000
    }
}

function aosToSoa(aos) {
    const soa = {};
    for (const k of Object.keys(aos[0])) {
        soa[k] = aos.map((x) => x[k]);
    }
    return soa;
}

function aosToSoaInclusive(aos) {
    const allKeys = Object.keys(aos[0]);
    for (const s of aos) {
        for (const k of Object.keys(s)) {
            if (allKeys.indexOf(k) < 0) allKeys.push(k);
        }
    }

    const soa = {};
    for (const k of allKeys) {
        soa[k] = aos.map((x) => x[k]);
    }
    return soa;
}


function soaToAos(soa) {
    const aos = [],
          keys = Object.keys(soa),
          length = soa[keys[0]].length;

    for (let i = 0; i < length; ++i) {
        const obj = {};
        for (const k of keys) obj[k] = soa[k][i];
        aos.push(obj);
    }
    return aos;
}
