import {isTamarindCompute} from '../compute';
import TamarindServiceForm from "../integrations/tamarind/TamarindServiceForm";
import Styled from './Styled';
import React, {createContext, useState, useReducer, useEffect, useContext, useCallback, useMemo, useRef} from 'react';
import {Container, Nav, Navbar, Form, Row, Col, Button, Table} from 'react-bootstrap';

import {DateTime} from 'luxon';

import {useParams, useNavigate, useActionData, Outlet, Link, Form as RRForm} from 'react-router';

import {useSlivka} from './SlivkaService';

const SlivkaJobCacheContext = createContext();

function usePeriodicUpdates(interval=5000) {
    const [tickNumber, doTick] = useReducer((x) => x+1, 0);
    useEffect(() => {
        const timer = setInterval(doTick, interval);
        return () => {clearInterval(timer)}
    });
    return tickNumber;
}

function jobStatusReducer(jobStatusMap, {_czekolada_sidecar: sidecar, ...updateStatus}) {
    const jid = updateStatus.id,
          oldStatus = jobStatusMap[jid] || {};


    if (sidecar) {
        updateStatus._czekolada_sidecar = {...(oldStatus._czekolada_sidecar || {}), ...sidecar};
    }

    return {
        ...jobStatusMap,
        [jid]: {
            ...oldStatus,
            ...updateStatus,
            _czekolada_dirty: true
        }
    };
}

export default function App({children}) {
    const slivka = useSlivka();

    const [jobStatusMap, updateJobStatus] = useReducer(jobStatusReducer, {}, () => {
        let jobStatusMap = {};
        for (let i = 0; i < localStorage.length; ++i) {
            const k = localStorage.key(i);
            if (k.startsWith('czjob.')) {
                try {
                    const j = JSON.parse(localStorage.getItem(k));
                    jobStatusMap[j.id] = j;
                } catch (err) {
                    console.log(err);
                }
            }
        }

        if (Object.keys(jobStatusMap).length === 0) {
            const jsStr = localStorage['czekolada.jobs'];
            if (jsStr) {
                try {
                    jobStatusMap = JSON.parse(jsStr);
                    for (const v of Object.values(jobStatusMap)) {
                        v._czekolada_dirty = true;
                    }
                } catch (err) {
                    console.log(err);
                }
            }
        }
        return jobStatusMap;
    });
    const jobStatusDirtyRef = useRef(false);
    const jobStatusRef = useRef(jobStatusMap);

    useEffect(() => {
        const listener = (ev) => {
            if (ev.key.startsWith('czjob.')) {
                updateJobStatus(JSON.parse(ev.newValue));
            }
        }
        window.addEventListener('storage', listener);
        return () => {
            window.removeEventListener('storage', listener);
        }
    }, [updateJobStatus]);

    useEffect(() => {
        for (const job of Object.values(jobStatusRef.current || {})) {
            // FIXME we should back off polling COMMS_ERR, but not stop completely.  For now, we continue
            // on the normal schedule.
            if (!job.finished && job.status !== 'NOT_FOUND'  && job.status !== 'UNKNOWN' /* && job.status !== 'COMMS_ERR' */) {
                slivka.watchJob(job.id, updateJobStatus);
            }
        }
    }, []);

    useEffect(() => {
        jobStatusRef.current = jobStatusDirtyRef.current = jobStatusMap;
    }, [jobStatusMap]);

    useEffect(() => {
        const interval = setInterval(() => {
            for (const v of Object.values(jobStatusRef.current)) {
                if (v._czekolada_dirty) {
                    delete v._czekolada_dirty;
                    localStorage['czjob.' + v.id] = JSON.stringify(v);
                }
            }
        }, 10000);

        return () => {
            clearInterval(interval);
        }
    }, []);

    const requestJob = useCallback(async (jobId) => {
        slivka.watchJob(jobId, updateJobStatus);
    }, [updateJobStatus]);

    const jobCache = useMemo(() => ({
        jobStatusMap,
        updateJobStatus,
        requestJob
    }), [jobStatusMap, requestJob])

    return (
        <SlivkaJobCacheContext.Provider value={jobCache}>
            {children}
        </SlivkaJobCacheContext.Provider>
    )
}

export function AppRoutes() {
    const root = [
        {
            path: '/',
            element: <Root />,
            children: [
                {
                    path: '',
                    exact: true,
                    element: <Hello />
                },
                {
                    path: '/services',
                    element: <ServiceList />
                },
                {
                    path: '/services/:serviceId',
                    element: <ServiceView />,
                    action: async (request) => {
                        const formData = await request.request.formData();
                        return {baseJob: formData.get('base_job')};
                    } 
                },
                {
                    path: '/jobs',
                    element: <JobsList />
                },
                {
                    path: '/jobs/:jobId',
                    element: <JobViewPage />
                }
            ]
        }
    ];
    return root;
}

function Hello() {
    return (
        <div>
            {isTamarindCompute() ? <>Compute jobs run on <a href="https://tamarind.bio">Tamarind Bio</a>.</> : 'Compute jobs run on the configured Slivka service.'}
        </div>
    );
}

function ServiceList() {
    const {services, loading=false, err=undefined} = useSlivka();

    if (loading) {
        return (
            <div>Loading services</div>
        );
    }
    if (err) {
        return (
            <div style={{color: 'red'}}>{err.message || err}</div>
        );
    }

    return (
        <Table striped bordered>
            <thead>
                <tr>
                    <th>Service</th>
                    <th>Description</th>
                </tr>
            </thead>
            <tbody>
                { services.map((s, i) => (
                    <tr key={i}>
                        <td><Link to={`/services/${s.id}`}>{s.name}</Link></td>
                        <td>{s.description}</td>
                    </tr>
                )) }
            </tbody>
        </Table>
    )
}

function ServiceView(props) {
    const {serviceId} = useParams();
    const {services, loading=false, err=[]} = useSlivka();
    const {jobStatusMap} = useContext(SlivkaJobCacheContext);
    const actionData = useActionData();

    const service = services.find((s) => s.id === serviceId);

    if (service) {
        return (
            <React.Fragment>
                <h3>{service.name}</h3>
                <p><i>{service.author}</i></p>
                <p>{service.description}</p>
                <ServiceLauncherPage service={service}
                                     key={serviceId} 
                                     baseParams={(jobStatusMap || {})[actionData?.baseJob]?.parameters}
                                     sidecar={(jobStatusMap || {})[actionData?.baseJob]?._czekolada_sidecar} />
            </React.Fragment>
        )
    } else if (err) {
        return (
            <div style={{color: 'red'}}>{err.message || err}</div>
        );
    } else if (loading) {
        return (
            <div>Loading services</div>
        );
    }  else {
        return (
            <div>Service "{ serviceId }" not available on this system</div>
        )
    };
}

function serviceConfigReducer(config, {key, value, index=undefined}) {
    if (index === undefined) {
        return {
            ...config,
            [key]: value
        };
    } else {
        if (! (config[key] instanceof Array)) throw Error(`${key} is not an array`);
        let newArray = [...config[key]];
        newArray[index] = value;
        return {
            ...config,
            [key]: newArray
        }
    }
}

function serviceConfigInit({service, baseParams={}, sidecar={}}) {
    const fileNames = sidecar.fileNames || {};
    const config = {};

    for (const param of (service.parameters || [])) {
        if (baseParams[param.id]) {
            if (param.type === 'file') {
                if (param.array) {
                    config[param.id] = baseParams[param.id].map((f, i) => (
                        (f instanceof Blob)
                            ? f
                            : {_slivkaFile: f, _slivkaFileName: (fileNames[param.id] || [])[i]}))
                } else {
                    config[param.id] = 
                        (baseParams[param.id] instanceof Blob) 
                            ? baseParams[param.id] 
                            : {_slivkaFile: baseParams[param.id], _slivkaFileName: fileNames[param.id]}
                }
            } else {
                config[param.id] = baseParams[param.id];
            }
        } else if (param.array) {
            if (param.required) {
                config[param.id] = [undefined];
            } else {
                config[param.id] = [];
            }
        } else if (param.default) {
            config[param.id] = param.default;
        }
    }
    return config;
}

function TextConfigControl({param, value, index, updateServiceConfig, disabled=false, isInvalid}) {
    const onChange = useCallback((ev) => {
        updateServiceConfig({
            key: param.id,
            index,
            value: ev.target.value.length > 0 ? ev.target.value : undefined
        })
    }, [param, updateServiceConfig, index]);

    return (
        <Form.Control type="text"
                      value={value || ''}
                      onChange={onChange}
                      disabled={disabled}
                      isInvalid={isInvalid}/>
    )
}

function IntegerConfigControl({param, value, index, updateServiceConfig, disabled=false, isInvalid}) {
    const [fieldValue, setFieldValue] = useState(typeof(value) === 'number' ? value.toString() : '');
    const onChange = useCallback((ev) => {
        const nfv = ev.target.value;
        setFieldValue(nfv);
        if (/^-?\d+$/.exec(nfv)) {
            updateServiceConfig({key: param.id, index, value: parseInt(nfv)});
        } else {
            updateServiceConfig({key: param.id, index, value: nfv.length === 0 ? undefined : Number.NaN});
        }
    }, [param, updateServiceConfig]);

    return (
        <Form.Control type="text"
                      value={fieldValue}
                      onChange={onChange}
                      disabled={disabled}
                      isInvalid={isInvalid}/>
    )
}

function DecimalConfigControl({param, value, index, updateServiceConfig, disabled=false, isInvalid}) {
    const [fieldValue, setFieldValue] = useState(typeof(value) === 'number' ? value.toString() : '');
    const onChange = useCallback((ev) => {
        const nfv = ev.target.value;
        setFieldValue(nfv);
        if (/^-?\d*(\.\d*)?$/.exec(nfv) && /\d/.exec(nfv)) {
            updateServiceConfig({key: param.id, index, value: parseFloat(nfv)});
        } else {
            updateServiceConfig({key: param.id, index, value: nfv.length === 0 ? undefined : Number.NaN});
        }
    }, [param, updateServiceConfig]);

    return (
        <Form.Control type="text"
                      value={fieldValue}
                      onChange={onChange}
                      disabled={disabled}
                      isInvalid={isInvalid}/>
    )
}

function ChoiceConfigControl({param, value, updateServiceConfig, disabled=false, isInvalid, constrainOptions: constrainOptionsList}) {
    const constrainOptions = useMemo(() => {
        if (!constrainOptionsList) return;

        return new Set(constrainOptionsList);
    }, [constrainOptionsList]);

    const onChange = useCallback((ev) => {
        updateServiceConfig({key: param.id, value: ev.target.value !== '__czekolada_none__' ? ev.target.value : undefined})
    }, [param, updateServiceConfig]);

    return (
        <Form.Select value={value || '__czekolada_none__'}
                     onChange={onChange}
                     disabled={disabled}
                     isInvalid={isInvalid}>
            { (param.required  && value) ? undefined : <option value="__czekolada_none__">-</option> }
            { (param.choices || []).map((opt, i) => (
                <option disabled={constrainOptions && !constrainOptions.has(opt)} value={opt} key={i}>{opt}</option>
            )) }
        </Form.Select>
    )
}

function MultiChoiceConfigControl({param, value, updateServiceConfig, disabled=false, isInvalid, constrainOptions: constrainOptionsList}) {
    const constrainOptions = useMemo(() => {
        if (!constrainOptionsList) return;

        return new Set(constrainOptionsList);
    }, [constrainOptionsList]);

    const onChange = useCallback((ev) => {
        const selectedSet = [];
        for (const child of ev.target.children) {
            if (child.selected) {
                selectedSet.push(child.value);
            }
        }
        updateServiceConfig({key: param.id, value: selectedSet})
    }, [param, updateServiceConfig]);

    return (
        <Form.Select multiple
                     disabled={disabled}
                     onChange={onChange} >
            { (param.choices || []).map((opt, i) => (
                <option disabled={constrainOptions && !constrainOptions.has(opt)} value={opt} key={i}>{opt}</option>
            )) }
        </Form.Select>
    )
}

function FlagConfigControl({param, value, updateServiceConfig, disabled=false, isInvalid}) {
    const onChange = useCallback((ev) => {
        updateServiceConfig({key: param.id, value: ev.target.checked});
    }, [param, updateServiceConfig]);

    return (
        <Form.Check type="checkbox"
                    onChange={onChange}
                    checked={value}
                    disabled={disabled}
                    isInvalid={isInvalid} />
    );
}

function FileConfigControl({param, value, index, updateServiceConfig, disabled=false, isInvalid}) {
    const onChange = useCallback((ev) => {
        updateServiceConfig({key: param.id, index, value: ev.target.files[0]})
    }, [param, updateServiceConfig]);

    const onRemove = useCallback((ev) => {
        updateServiceConfig({key: param.id, index, value: undefined});
    }, [param, updateServiceConfig]);

    if (value?._slivkaFile) {
        return (
            <div>
                Compute file: <a href={`/media/uploads/${value._slivkaFile}`} download>{value._slivkaFileName || value._slivkaFile}</a>&nbsp;
                <Button disabled={disabled} onClick={onRemove}>Use another file</Button>
            </div>
        )
    } else {
        return (
            <Form.Control type="file"
                          isInvalid={isInvalid}
                          disabled={disabled}
                          onChange={onChange} />
        );
    }
}

function MultiConfigControl({param, value, updateServiceConfig, isInvalid, Control, disabled=false}) {
    const onAdd = useCallback(() => {
        if (!disabled) updateServiceConfig({key: param.id, value: undefined, index: value.length})
    }, [updateServiceConfig, value, param, disabled])

    const controls = [];
    for (let i = 0; i < value.length; ++i) {
        controls.push(
            <Control key={i}
                     value={value[i]}
                     index={i}
                     param={param}
                     isInvalid={isInvalid}
                     disabled={disabled}
                     updateServiceConfig={updateServiceConfig} />
        );
    }

    return (
        <React.Fragment>
            { controls }
            <Button disabled={disabled} onClick={onAdd}>+</Button>
        </React.Fragment>
    )
}

export function configMapToFormData(service, config) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(config)) {
        if (value === undefined || value === null) continue;

        if (value && value instanceof Array) {
            for (const vi of value) {
                if (vi !== undefined) {
                    if (vi?._slivkaFile) {
                        formData.append(key, vi._slivkaFile);
                    } else {
                        formData.append(key, vi);
                    }
                }
            }
        } else {
            if (value?._slivkaFile) {
                formData.append(key, value._slivkaFile);
            } else {
                formData.append(key, value/*, (value && (value instanceof File)) ? value.name : undefined */);
            }
        }
    }
    return formData;
}

function configMapToSidecar(service, config) {
    const sidecar = {
        fileNames: {}
    };

    for (const [key, value] of Object.entries(config)) {
        if (value instanceof File) {
            sidecar.fileNames[key] = value.name;
        } else if (value?._slivkaFileName) {
            sidecar.fileNames[key] = value._slivkaFileName;
        } else if (value instanceof Array) {
            sidecar.fileNames[key] = value.filter((f) => f !== undefined).map((f) => {
                if (f instanceof File) {
                    return f.name;
                } else if (f?._slivkaFileName) {
                    return f._slivkaFileName;
                }
            });
        }
    }

    let nameParts = [];
    for (const param of (service.parameters || [])) {
        if (param.type === 'file' && sidecar.fileNames[param.id]) {
            nameParts.push(sidecar.fileNames[param.id]);
        }
    }
    for (const param of (service.parameters || [])) {
        if (param.type !== 'file' && config[param.id]) {
            nameParts.push('' + config[param.id]);
        }
    }

    nameParts = nameParts.map((np) => np.length < 20 ? np : np.substring(0, 10) + '...');
    if (nameParts.length > 4) {
        nameParts.splice(4);
    }

    if (nameParts.length > 0) {
        sidecar.name = nameParts.join('; ')
    }

    return sidecar;
}

function ServiceLauncherPage(props) {
    const {updateJobStatus} = useContext(SlivkaJobCacheContext);

    const navigate = useNavigate();
    const hasNavigated = useRef(false);

    const listener = useCallback((status) => {
        if (!hasNavigated.current) {
            hasNavigated.current = true;
            navigate(`/jobs/${status.id}`);
        }

        updateJobStatus(status);
    }, [updateJobStatus]);

    return (
        <ServiceLauncher {...props}
                         listener={listener} />
    );
}

export function ServiceLauncher({service, ...otherProps}) {
    const {services, error, loading} = useSlivka();

    if (typeof(service) === 'string') {
        const serviceName = service;
        service = services.find((s) => s.id === service);
        if (!service) {
            if (loading) {
                return (
                    <div>Loading...</div>
                );
            } else if (error) {
                return (
                    <div style={{color: 'red'}}>Could not load compute tools. Please refresh and try again.</div>
                );
            } else {
                return (
                    <div style={{color: 'red'}}>Service {serviceName} not available</div>
                );
            }
        }
    }

    return (
        <ServiceLauncherImpl {...otherProps}
                             service={service} />
    );
}

export function ServiceLauncherImpl({
    listener,
    parameterCallback,
    service,
    baseParams,
    sidecar,
    slivkaOpts={},
    constrainParams: constrainParamsList=[],
    hideParams: hideParamsList=[],
    skipValidationParams: skipValidationParamsList=[],
    constrainOptions={},
    showProgress=false,
    showSubmitButton=true,
    showCancelButton=false
}) {
    const constrainParams = useMemo(() => new Set(constrainParamsList), [constrainParamsList]);
    const hideParams = useMemo(() => new Set(hideParamsList), [hideParamsList]);
    const skipValidationParams = useMemo(() => new Set(skipValidationParamsList), [skipValidationParamsList]);

    const [serviceConfig, updateServiceConfig] = useReducer(serviceConfigReducer, {service, baseParams, sidecar}, serviceConfigInit);
    const [submitted, setSubmitted] = useState(false);
    const [jid, setJID] = useState(undefined);
    const [status, setStatus] = useState(undefined);
    const [jobDetails, setJobDetails] = useState({});
    const [requestError, setRequestError] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const submitLock = useRef(false);
    const attempt = useRef(0);
    const terminalAttempt = useRef(null);
    const [importing, setImporting] = useState(false);
    const hosted = isTamarindCompute();

    const slivka = useSlivka();
    
    const errors = useMemo(() => {
        const errors = {};
        service.parameters.forEach((param) => {
            if (skipValidationParams.has(param.id)) {
                return;
            }

            let err = undefined;
            const value = serviceConfig[param.id]
            if (hosted && !param.array && ['integer','decimal'].includes(param.type)) {
                if (value === undefined) {
                    if (param.required) errors[param.id] = 'Required';
                } else if (!Number.isFinite(value) || (param.type === 'integer' && !Number.isInteger(value))) {
                    errors[param.id] = `Must be a valid ${param.type}`;
                } else if (param.min !== undefined && (param.minExclusive ? value <= param.min : value < param.min)) {
                    errors[param.id] = `Must be ${param.minExclusive ? '>' : '>='} ${param.min}`;
                } else if (param.max !== undefined && (param.maxExclusive ? value >= param.max : value > param.max)) {
                    errors[param.id] = `Must be ${param.maxExclusive ? '<' : '<='} ${param.max}`;
                }
                return;
            }
            if (param.required) {
                if (param.array) {
                    if (value === undefined || (value instanceof Array && !(value.some((x) => x)))) {
                        err = 'Must provide at least one value';
                    }
                } else {
                    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
                        err = 'Required';
                    } 
                }
            } else {
                if (param.type === 'decimal' || param.type === 'integer') {
                    if (Number.isNaN(value)) {
                        err = `Must be a ${param.type}`;
                    } 

                    if (!err && param.min !== undefined) {
                        if (param.minExclusive) {
                            if (value <= param.min) {
                                err = `Must be > ${param.min}`
                            }
                        }  else {                             
                            if (value < param.min) {
                                err = `Must be >= ${param.min}`
                            }
                        }
                    }  if (!err && param.max !== undefined) {
                        if (param.maxExclusive) {
                            if (value >= param.max) {
                                err = `Must be < ${param.max}`
                            }
                        }  else {                             
                            if (value > param.max) {
                                err = `Must be <= ${param.max}`
                            }
                        }
                    }
                }
            }

            if (err) {
                errors[param.id] = err;
            }
        });
        return errors;
    }, [serviceConfig, service, skipValidationParams]);
    const validErrors = Object.keys(errors).length > 0;

    useEffect(() => {
        if (parameterCallback) {
            parameterCallback(serviceConfig, validErrors ? errors : undefined);
        }
    }, [serviceConfig, errors, parameterCallback]);

    const slListener = useCallback(async (status, currentAttempt) => {
        // Ignore duplicate terminal notifications and late events from an older job.
        if (currentAttempt !== attempt.current || terminalAttempt.current === currentAttempt) return;
        if (status?.finished) terminalAttempt.current = currentAttempt;
        setStatus(status?.status);
        setJobDetails(previous => ({...previous, ...status}));
        if (status?.id) setJID(status.id);
        if (status?.status === 'COMPLETED') setImporting(true);
        try {
            await listener?.(status);
        } catch (err) {
            if (currentAttempt === attempt.current) setRequestError(err.message || 'Could not process the job results.');
        } finally {
            if (status?.finished && currentAttempt === attempt.current) {
                setImporting(false);
                setSubmitted(false);
                submitLock.current = false;
            }
        }
    }, [listener]);

    const submit = useCallback(() => {
        if (submitLock.current || validErrors) return;
        submitLock.current = true;
        const currentAttempt = ++attempt.current;
        (async () => {
            setSubmitted(true);
            setRequestError('');
            setStatus('SUBMITTING');
            setJobDetails({});
            setJID(undefined);

            const sidecar = configMapToSidecar(service, serviceConfig);
            const augListener = (status) => {
                if (slListener) {
                    return slListener({...status, _czekolada_sidecar: sidecar}, currentAttempt);
                }
            }

            try {
                await slivka.submit(
                    service.id,
                    configMapToFormData(service, serviceConfig), 
                    slivkaOpts,
                    augListener
                );
            } catch (err) {
                setRequestError(err.message || String(err));
                setStatus(undefined);
                setSubmitted(false);
                submitLock.current = false;
            } finally {
                // ...
            }
        })()
    }, [service, serviceConfig, slListener, slivka, slivkaOpts, validErrors]);

    const cancel = useCallback(async () => {
        if (!jid || cancelling) return;
        setCancelling(true);
        setRequestError('');
        try {
            await slivka.cancel(jid);
            setStatus(previous => ['COMPLETED','FAILED','CANCELLED'].includes(previous) ? previous : 'CANCELLING');
        } catch (err) {
            setRequestError(err.message || 'Could not cancel the job. Please try again.');
        } finally {
            setCancelling(false);
        }
    }, [jid, cancelling, slivka]);

    function controlForParam(param, value, isInvalid) {
        const constrained = constrainParams.has(param.id) || (hosted && submitted);

        let Control;

        if (param.type === 'text') {
            Control = TextConfigControl;
        } else if (param.type === 'choice') {
            Control = ChoiceConfigControl;
        } else if (param.type === 'flag') {
            Control = FlagConfigControl;
        } else if (param.type === 'file') {
            Control = FileConfigControl;
        } else if (param.type === 'decimal') {
            Control = DecimalConfigControl;
        } else if (param.type === 'integer') {
            Control = IntegerConfigControl;
        }

        if (param.array) {
            /* if (param.type === 'file') {
                return <div>NYI: filearray</div>
            } else */ if (param.type === 'choice') {
                return <MultiChoiceConfigControl param={param}
                                                 value={value}
                                                 updateServiceConfig={updateServiceConfig}
                                                 disabled={constrained}
                                                 constrainOptions={constrainOptions[param.id]}
                                                 isInvalid={isInvalid} />
            } else if (Control) {
                return <MultiConfigControl Control={Control}
                                           param={param}
                                           value={value}
                                           updateServiceConfig={updateServiceConfig}
                                           disabled={constrained}
                                           isInvalid={isInvalid} />
            } else {
                return <div>NYI: {param.type} array</div>
            }
        } else if (Control) {
            return (
                <Control param={param}
                         value={value}
                         updateServiceConfig={updateServiceConfig}
                         isInvalid={isInvalid}
                         constrainOptions={constrainOptions[param.id]}
                         disabled={constrained} />
            );
        } else {
            return <div>NYI: {param.type}</div>
        }
    }

    if (hosted) return <TamarindServiceForm
        parameters={service.parameters.filter(param => !hideParams.has(param.id))}
        config={serviceConfig} errors={errors} update={updateServiceConfig}
        disabled={param => submitted || constrainParams.has(param.id)}
        fallback={(param, value, invalid) => <Styled>{controlForParam(param, value, invalid)}</Styled>}
        status={status} submitted={submitted} importing={importing} resultUrl={jobDetails.resultUrl} error={requestError || (status === 'FAILED' ? jobDetails.message : '')}
        submit={submit} cancel={cancel} cancelling={cancelling}
        canCancel={!!jid && submitted && !jobDetails.finished}
        canSubmit={!validErrors && !submitted && !cancelling}
        showSubmitButton={showSubmitButton} />;

    return (
        <React.Fragment>
            <Form>
                {service.parameters.filter((param) => !hideParams.has(param.id)).map((param) => {
                    const err = errors[param.id];
                    const value = serviceConfig[param.id]

                    return (
                        <Form.Group as={Row} className="mb-3" key={param.id} controlId={param.id}>
                            <Form.Label column sm={4}>
                                {param.name || param.id}
                                {param.description
                                    ? <div style={{fontSize: "75%"}}>{param.description}</div>
                                    : undefined }
                            </Form.Label>
                            <Col sm={8}>
                                { controlForParam(param, serviceConfig[param.id], !!err) }
                                {err 
                                   ? <Form.Control.Feedback type="invalid">{err}</Form.Control.Feedback>
                                   : undefined }
                            </Col>
                        </Form.Group>
                    );
                })}
            </Form>

            {requestError && <div role="alert" style={{color: 'red'}}>{requestError}</div>}
            <Row>
                { showSubmitButton
                  ? <Col sm={3}>
                        <Button variant="primary" disabled={validErrors || submitted} onClick={submit}>
                            Run Job
                        </Button>
                    </Col>
                  : undefined }
                { showCancelButton
                  ? <Col sm={3}>
                        <Button variant="danger" disabled={!jid} onClick={cancel}>
                            Cancel
                        </Button>
                    </Col>
                  : undefined }
                { showProgress
                  ? <Col sm={6}>
                        { status }
                    </Col>
                  : undefined }
            </Row>
        </React.Fragment>
    )
}

function JobsList() {
    usePeriodicUpdates();

    const {jobStatusMap} = useContext(SlivkaJobCacheContext);

    const jobList = Object.values(jobStatusMap || {}).filter((j) => j.status !== 'COMMS_ERR' && j.status !== 'NOT_FOUND');
    jobList.sort((a, b) => -((a.submissionTime || '').localeCompare(b.submissionTime || '')))
    if (jobList.length === 0) {
        return (
            <div>No jobs here.  Select a <Link to="/services">service</Link> to launch.</div>
        );
    }

    const now = DateTime.now();
    const formatDate = (d) => {
        if (!d) return '-';
        const dt = DateTime.fromISO(d).toLocal();
        if (Math.abs(now.diff(dt).as('days')) > 5) {
            return dt.toLocaleString();
        } else {
            return dt.toRelative();
        }
    }

    return (
        <Table striped bordered>
            <thead>
                <tr>
                    <th>Job</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Submitted time</th>
                </tr>
            </thead>
            <tbody>
                { jobList.map((job) => (
                    <tr key={job.id}>
                        <td><Link to={`/jobs/${job.id}`}>{job._czekolada_sidecar?.name ?? job.id}</Link></td>
                        <td>{job.service}</td>
                        <td>{job.status}</td>
                        <td>{formatDate(job.submissionTime)}</td>
                    </tr>
                )) }
            </tbody>
        </Table>
    );
}

function JobViewPage() {
    const {jobId} = useParams();
    const {jobStatusMap, requestJob, updateJobStatus} = useContext(SlivkaJobCacheContext);
    

    const status = (jobStatusMap || {})[jobId];

    useEffect(() => {
        if (!status) {
            requestJob(jobId)
        }
    }, [jobId, requestJob, status])


    return (
        <JobView status={status}
                 updateJobStatus={updateJobStatus}
                 appMode />
    )
}

export function JobView({jobId, explicitURL, ...props}) {
    const slivkaService = useSlivka();
    const [jobStatus, setJobStatus] = useState();

    useEffect(() => {
        setJobStatus(undefined);
        const sub = slivkaService.watchJob(jobId, setJobStatus, explicitURL);
        return () => {sub.unsubscribe()};
    }, [jobId, explicitURL]);

    if (!jobStatus) {
        return (<div>Loading...</div>)
    } else if (isTamarindCompute() && jobStatus.resultUrl) {
        return <a href={jobStatus.resultUrl} target="_blank" rel="noopener noreferrer">View results in Tamarind Bio</a>;
    } else {
        return (
            <JobViewImpl status={jobStatus}
                         jobId={jobId}
                         explicitURL={explicitURL}
                         {...props} />
        );
    }
}

function JobViewImpl({status, updateJobStatus, appMode=false}) {
    usePeriodicUpdates();
    const {services} = useSlivka();

    const [editingTitle, setEditingTitle] = useState(false)

    const service = useMemo(() => {
        if (status?.service) {
            const service = services.find((s) => s.id === status?.service);
            if (service) return service;
        }
        return {
            name: 'Unknown service'
        }
    }, [status?.service, services]);


    const now = DateTime.now();
    const formatDate = (d) => {
        if (!d) return '-';
        const dt = DateTime.fromISO(d).toLocal();
        if (Math.abs(now.diff(dt).as('days')) > 5) {
            return dt.toLocaleString();
        } else {
            return dt.toRelative();
        }
    }

    const title = status?._czekolada_sidecar?.name ?? `Job ${status?.id}`;

    if (!status || status.status === 'NOT_FOUND') {
        return (
            <div>Job not found</div>
        );
    } else {
        return (
            <React.Fragment>
                <Row xs={10} md={10} lg={10}>
                    <Col xs={4}>
                        { editingTitle === false 
                            ? <h3 onDoubleClick={updateJobStatus ? () => setEditingTitle(title) : undefined}>
                                  { title }
                              </h3>
                            : <input type="text" 
                                     value={editingTitle}
                                     ref={(input) => {input?.focus()}}
                                     onChange={(ev) => setEditingTitle(ev.target.value) }
                                     onKeyDown={(ev) => {
                                        if (ev.code === 'Enter') {
                                            updateJobStatus({id: status?.id, _czekolada_sidecar: {name: editingTitle}})
                                            setEditingTitle(false);
                                      } else if (ev.code === 'Escape') {
                                            setEditingTitle(false);
                                      }}} /> }
                    </Col>
                    {appMode 
                      ? <Col xs={8}>
                            <RRForm method="post" action={`/services/${service.id}`}>
                                <input type="hidden" name="base_job" value={status?.id} />
                                <Button as="input" type="submit" value="Run another job like this" />
                            </RRForm>
                        </Col> 
                      : undefined }
                </Row>

                <Table striped bordered>
                    <tbody>
                        {<tr>
                            <th>Run with</th>
                            <td width="66%">{appMode ? <Link to={`/services/${service.id}`}>{service.name}</Link> : service.name}</td>
                        </tr>}
                        <tr>
                            <th>Status</th>
                            <td>{status.status}</td>
                        </tr>
                        {status.submissionTime 
                            ? <tr>
                                <th>Submitted</th>
                                <td>{formatDate(status.submissionTime)}</td>
                              </tr>
                            : undefined}
                        {status.completionTime 
                            ? <tr>
                                <th>Completed</th>
                                <td>{formatDate(status.completionTime)}</td>
                              </tr>
                            : undefined}
                    </tbody>
                </Table>

                {status.finished ? <JobOutputView jobId={status.id} /> : undefined}
            </React.Fragment>
        );
    }
}

function JobOutputView({jobId, explicitURL}) {
    const slivkaService = useSlivka();

    const [jobFiles, setJobFiles] = useState(undefined);
    const [viewData, updateViewData] = useReducer(
        (oldViewData, {id, data}) => {
            const newViewData = [...oldViewData];
            newViewData[id] = data;
            return newViewData;
        },
        []
    );

    const toggleView = useCallback((ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const fid = parseInt(ev.target.dataset.fid);
        if (viewData[fid]) {
            updateViewData({id: fid, data: undefined});
        } else {
            updateViewData({id: fid, data: {loading: true}});
            (async () => {
                const resp = await fetch(jobFiles.files[fid]['@content']);
                if (!resp.ok) throw Error(resp.statusText);
                const data = await resp.text();
                updateViewData({id: fid, data: {data: data}});
            })();
        }
    }, [jobFiles, viewData])

    useEffect(() => {
        (async () => {
            try {
                const result = await slivkaService.fetchRaw(jobId);
                setJobFiles(result);
            } catch (err) {
                setJobFiles({error: err.message || err})
            }
        })();
    }, [jobId]);

    if (jobFiles === undefined) {
        return (
            <div>Fetching files</div>
        );
    } else if (jobFiles.error) {
        return (
            <div style={{color: 'red'}}>{jobFiles.error}</div>
        )
    }

    return (
        <React.Fragment>
            <h4>Outputs</h4>
            <Table striped bordered>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Filename</th>
                        <th>Content</th>
                    </tr>
                </thead>
                <tbody>
                    { jobFiles.files.map((file, i) => (
                        <tr key={i}>
                            <td>{file.label}</td>
                            <td>{file.path}</td>
                            <td width="66%">
                                <a href={file['@content']}
                                   download
                                   filename={file.path}>
                                    [Download]
                                </a>

                                {file.mediaType && file.mediaType.startsWith('text/')
                                    ? <a href="#"
                                         onClick={toggleView}
                                         data-fid={i}>
                                        { viewData[i] ? '[Hide]' : '[View]' }
                                       </a>
                                    : undefined }

                                {viewData[i] && typeof(viewData[i].data) === 'string' 
                                    ? <pre style={{
                                            background: 'black',
                                            color: 'orange',
                                            padding: '0.5em',
                                            overflow: 'scroll',
                                            maxHeight: '20em',
                                            margin: 0}}>
                                        {viewData[i].data}
                                      </pre>
                                    : undefined }
                            </td>
                        </tr>
                    )) }
                </tbody>
            </Table>
        </React.Fragment>
    );
}

function Root() {
    return (
        <React.Fragment>
            <Navbar bg="light">
                <Container>
                    <Navbar.Brand as={Link} to="/">
                        <img alt="Czekolada" src="/czekolada_logo_720.png" width="359" height="60" />
                    </Navbar.Brand>
                    <Nav>
                        <Nav.Link as={Link} to="/services">Services</Nav.Link>
                    </Nav>
                    <Nav className="me-auto">
                        <Nav.Link as={Link} to="/jobs">Jobs</Nav.Link>
                    </Nav>
                </Container>
            </Navbar>
            <Container>
                <Outlet />
            </Container>
        </React.Fragment>
    );
}
