import React, {useState, useMemo, useEffect, useCallback} from 'react';

import Upload from './Upload';
import Landingpage from './Landingpage';
import SessionView from './SessionView';
import EnterSeq from './EnterSeq';
import EnterSeqIDs from './EnterSeqIDs';
import { Button } from '@mui/material';

import {useLocation, useParams, useNavigate} from 'react-router';

import {
    FileUploadOutlined, List
} from '@mui/icons-material';


const DEFAULT_DATASET_COMPONENTS = [
    {
        Component: EnterSeq,
        key: 'enter-seq',
        label: 'Enter Sequences',
        subtitle: '(For Alphafold, Fab predictions, etc.)'
    },
    {
        Component: EnterSeqIDs,
        Icon: List,
        key: 'enter-seq-ids',
        label: 'Sequence/Structure IDs'
    },
    {
        Component: Upload,
        Icon: FileUploadOutlined,
        key: 'upload',
        label: 'Upload data file',
        subtitle: 'CSV, XLSX, FASTA, PDB'
    }
];


const Homepage = (props) => {
    const {onDataLoad: onDataLoadRaw,
        sessionHistory, sessionHistoryErr, sessionActionErrors, deletingSessions, tabs, refreshHistory,
        loadHistoricalSession, switchToHistoricalSession, deleteHistoricalSession,
        updateShareFlag, updateDescription, updateName, goToTabs,
        extraDatasetComponents=[], idLookups=[], landingPageAddendum
    } = props;

    const components = useMemo(() => (
        [...DEFAULT_DATASET_COMPONENTS, ...extraDatasetComponents]
    ), [DEFAULT_DATASET_COMPONENTS, extraDatasetComponents]);

    const loc = useLocation();
    const params = useParams();
    const navigate = useNavigate();

    const onDataLoad = useCallback((data, opts) => {
        const url = onDataLoadRaw(data, opts);
        navigate(url);
    }, [onDataLoadRaw, navigate]);

    useEffect(() => {
        const loadSession = new URLSearchParams(window.location.search).get('load_session');
        if (loadSession) {
            navigate(`/dataset/${loadSession}`);
        }
    }, []);

    const isCollapsed = loc.pathname !== '/' && loc.pathname !== '/new';
    const selectedOption = loc.pathname === '/' ? '/' : loc.pathname === '/datasets' ? 'session' : params.ccc;
    useEffect(() => {
        if (selectedOption === 'session') refreshHistory?.();
    }, [selectedOption, refreshHistory]);

    return (
        <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
            <Landingpage
                selectedOption={selectedOption}
                isCollapsed={isCollapsed}
                tabs={tabs}
                goToTabs={goToTabs}
                availableComponents={components}
                addendum={landingPageAddendum}
            />

            {
                components.map(({key, Component}) => (
                    <div key={key}
                         style={{
                             display: selectedOption === key ? 'block': 'none',
                             backgroundColor: '#153452',
                             color: 'white',
                             flexGrow: 4
                    }}>
                        <Component onDataLoad={onDataLoad}
                                   loadedSessions={tabs}
                                   idTypes={idLookups} />
                    </div>
                ))
            }

            <div 
                style={{
                    display: selectedOption === 'session' ? 'block' : 'none',
                    border: '2rem solid #153452',
                    backgroundColor: '#153452',
                    color: 'white',
                    flexGrow: 1
                }}
            >
                <SessionView 
                    sessionHistory={sessionHistory}
                    sessionHistoryErr={sessionHistoryErr}
                    sessionActionErrors={sessionActionErrors}
                    deletingSessions={deletingSessions}
                    tabs={tabs}
                    loadHistoricalSession={loadHistoricalSession}
                    switchToHistoricalSession={switchToHistoricalSession}
                    deleteHistoricalSession={deleteHistoricalSession} 
                    updateShareFlag={updateShareFlag} 
                    updateDescription={updateDescription}
                    updateName={updateName}
                />
            </div>
        </div>
    )
}

export default Homepage;
