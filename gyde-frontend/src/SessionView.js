import React, {useCallback, useState, useReducer, useEffect} from 'react';

import {DateTime} from 'luxon';
import {useNavigate} from 'react-router';

import {Button, ButtonGroup, Table, TableHead, TableBody, TableRow, TableCell, Tooltip, TextField, MenuItem,
    CircularProgress, Menu, Grid, Alert } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import DeleteIcon from '@mui/icons-material/Delete';
import FileOpenIcon from '@mui/icons-material/FileOpen';
import VpnLock from '@mui/icons-material/VpnLock';
import Public from '@mui/icons-material/Public';
import PublicOff from '@mui/icons-material/PublicOff';
import ViewIcon from '@mui/icons-material/Visibility';
import {createTheme, ThemeProvider, styled} from '@mui/material/styles';

import {usePeriodicUpdates} from './utils/hooks';

const theme = createTheme({
    palette: {
        mode: 'dark',
        background: '#153452'
    }
})

// Default menu styling involves fractional-alpha and looks awful with our colour scheme.
// So let's do hover and selected effects "manually" for now.
const menuItemStyle = {
    backgroundColor: '#153452',
    '&:hover': {backgroundColor: '#457482'},
    '&.Mui-selected': {
        backgroundColor: '#254462',
        '&:hover': {backgroundColor: '#457482'}
    }
};

export default function SessionView({
    sessionHistory,
    sessionHistoryErr,
    sessionActionErrors = {},
    deletingSessions = [],
    tabs,
    loadHistoricalSession,
    switchToHistoricalSession,
    deleteHistoricalSession,
    updateShareFlag,
    updateDescription,
    updateName
}) {
    const navigate = useNavigate();

    const viewedHistory = new Set();
    for (const tab of tabs || []) {
        if (tab._external_id) viewedHistory.add(tab._external_id);
    }

    const [editingName, setEditingName] = useState();
    const [editingDescription, setEditingDescription] = useState();

    const nameClickHandler = useCallback((ev) => {
        const sid = getSID(ev.target);
        setEditingName(sid);
        setEditingDescription(undefined);
    }, [])

    const descClickHandler = useCallback((ev) => {
        const sid = getSID(ev.target);
        setEditingDescription(sid);
        setEditingName(undefined);
    }, []);

    const editDescFinished = useCallback((newDesc) => {
        if (newDesc !== undefined) updateDescription(editingDescription, newDesc);
        setEditingDescription(undefined);
    }, [updateDescription, editingDescription]);

    const editNameFinished = useCallback((newName) => {
        if (newName !== undefined) updateName(editingName, newName);
        setEditingName(undefined);
    }, [updateName, editingName]);

    const loadHandler = useCallback((ev) => {
        const sid = getSID(ev.target);
        navigate(`/dataset/${sid}`);
    }, []);

    const switchHandler = useCallback((ev) => {
        const sid = getSID(ev.target);
        navigate(`/dataset/${sid}`);
    }, []);

    const deleteHandler = useCallback((ev) => {
        const sid = getSID(ev.currentTarget);
        if (!sid || !window.confirm('Really delete?  This cannot be undone.')) return;
        deleteHistoricalSession(sid);
    }, [deleteHistoricalSession]);

    const [shareAnchor, setShareAnchor] = useState(null);
    const openShareMenu = useCallback((ev) => {
        setShareAnchor(ev.currentTarget);
    }, []);
    const closeShareMenu = useCallback(() => {
        setShareAnchor(null);
    }, []);
    const onShareMenuSelect = useCallback((ev) => {
        const sid = getSID(shareAnchor)
        const record = sessionHistory.find((s) => s.id === sid);
        if (!record) return;

        const value = ev.currentTarget.getAttribute('value');
        updateShareFlag(sid, !(value === 'private'), value === 'public');
        setShareAnchor(null);
    }, [shareAnchor, sessionHistory, updateShareFlag])

    usePeriodicUpdates(10000);

    const copyUrlHandler = useCallback((ev) => {
        const sid = getSID(ev.target);
        const item = sessionHistory.filter((h) => h.id === sid)[0];
        if (item && !item.shared && !item.public) {
            window.alert("Warning: this dataset isn't currently shared, this link will not work for other users");
        }

        const url = `${window.location.protocol}//${window.location.host}/dataset/${sid}`;

        (async () => {
            try {
                await navigator.clipboard.writeText(url);
            } catch (err) {
                console.log('URL copying failed', err);
            }
        })();
    }, [sessionHistory]);

    const history = [...(sessionHistory || [])]
    history.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));

    const now = DateTime.now();
    function formatDate(d) {
        if (!d) return '-';
        const dt = DateTime.fromISO(d).toLocal();
        if (Math.abs(now.diff(dt).as('days')) > 5) {
            return dt.toLocaleString();
        } else {
            return dt.toRelative();
        }
    }

    const [sessionFilter, setSessionFilter] = useState('');

    const mySessions = history.filter((h) => !h._gyde_readonly),
          sharedSessions = history.filter((h) => h._gyde_readonly),
          mySessionsFiltered = filterSessions(mySessions, sessionFilter),
          sharedSessionsFiltered = filterSessions(sharedSessions, sessionFilter);

    if (sessionHistoryErr) {
        return (
            <ThemeProvider theme={theme}>
                <div style={{display: 'flex', alignItems: 'center', flexDirection: 'column', color: 'red'}}>
                    Error loading sessions, try reloading GYDE
                </div>
            </ThemeProvider>
        )
    } else if (!sessionHistory) {
        return (
            <ThemeProvider theme={theme}>
                <div style={{display: 'flex', alignItems: 'center', flexDirection: 'column', marginBottom: '2rem'}}>
                    Loading datasets, please wait
                </div>
                <div style={{display: 'flex', alignItems: 'center', flexDirection: 'column'}}>
                    <CircularProgress />
                </div>
            </ThemeProvider>
        )
    }

    function sessionTable(history, isOwned) {
        if (!history || history.length === 0) {
            return (<div>No matches</div>)
        }
        return (
            <React.Fragment>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell style={{/*width: '50%' */}}>Name</TableCell>
                            <TableCell>Modified</TableCell>
                            { isOwned ? null : <TableCell>Owner</TableCell> }
                            <TableCell>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        { history.map((h, i) => (
                            <TableRow key={h.id} data-sid={h.id}>
                                <TableCell>
                                    {h.id === editingName
                                        ? <SessionFieldEditor init={h.name || ''}
                                                              onEditFinished={editNameFinished} />
                                        : <div onDoubleClick={isOwned ? nameClickHandler : undefined}>
                                            {h.name}
                                          </div>}

                                    {h.id === editingDescription
                                        ? <SessionFieldEditor init={h.description || ''}
                                                              onEditFinished={editDescFinished} />
                                        : h.description || isOwned
                                            ? <div onDoubleClick={isOwned ? descClickHandler : undefined}
                                                   style={{
                                                      fontSize: '80%',
                                                      fontStyle: h.description ? undefined : 'italic'
                                               }}>
                                                  {h.description || 'Double-click to add description'}
                                              </div>
                                             : undefined }
                                </TableCell>
                                <TableCell>{formatDate(h.lastModified)}</TableCell>
                                { isOwned ? null : <TableCell>{h.user_name}</TableCell> }
                                <TableCell>
                                    <ButtonGroup variant="outlined" data-sid={h.id}>
                                        { viewedHistory.has(h.id)
                                            ? undefined
                                            : <Tooltip title="Load this session">
                                                  <Button  color="primary" onClick={loadHandler}><FileOpenIcon /></Button> 
                                              </Tooltip> }
                                        { viewedHistory.has(h.id)
                                            ? <Tooltip title="This session is already loaded.  Click to switch tab">
                                                   <Button  color="primary" onClick={switchHandler}><ViewIcon /></Button> 
                                              </Tooltip>
                                            : undefined }
                                        <Tooltip title="Copy link to clipboard">
                                            <Button  onClick={copyUrlHandler}><LinkIcon /></Button>
                                        </Tooltip>
                                        <Tooltip title={  h.public ? "Shared" : h.shared ? "Sharable with link" : "Private" } >
                                            <Button disabled={!isOwned} onClick={openShareMenu} >
                                                {  h.public ? <Public /> : h.shared ? <VpnLock /> : <PublicOff /> }
                                            </Button>
                                        </Tooltip>
                                        {isOwned
                                            ? <Button disabled={viewedHistory.has(h.id) || deletingSessions.includes(h.id)}
                                                    aria-label={deletingSessions.includes(h.id) ? "Deleting dataset" : "Delete dataset"}
                                                    onClick={deleteHandler} >
                                                <Tooltip title="Delete this dataset">{deletingSessions.includes(h.id) ? <CircularProgress size={18} /> : <DeleteIcon />}</Tooltip>
                                            </Button>
                                            : undefined }
                                    </ButtonGroup>
                                </TableCell>
                            </TableRow>
                        )) }
                    </TableBody>
                </Table>
                <Menu id="sharing-menu"
                      onClose={closeShareMenu}
                      open={!!shareAnchor}
                      anchorEl={shareAnchor}
                      disableElevation >

                    <MenuItem onClick={onShareMenuSelect} sx={menuItemStyle} value="private">
                        <PublicOff />Private
                    </MenuItem>

                    <MenuItem onClick={onShareMenuSelect} sx={menuItemStyle} value="sharable">
                        <VpnLock />Sharable (with link)
                    </MenuItem>

                    <MenuItem onClick={onShareMenuSelect} sx={menuItemStyle} value="public">
                        <Public />Shared
                    </MenuItem>

                </Menu>
            </React.Fragment>
        )
    }

    return (
         <ThemeProvider theme={theme}>
            <Grid container columns={{xs: 4}} spacing={4}>
                {Object.entries(sessionActionErrors).filter(([, message]) => message).map(([id, message]) => (
                    <Grid item xs={4} key={id}><Alert severity="error">
                        {sessionHistory?.find(row => row.id === id)?.name || 'Dataset'}: {message}
                    </Alert></Grid>
                ))}
                <Grid item xs={1}/>
                <Grid item xs={2}>
                    <TextField style={{width: '100%', paddingBottom: '2rem'}}
                               id="search" 
                               placeholder="Search in your datasets list...."
                               value={sessionFilter}
                               onChange={(ev) => setSessionFilter(ev.target.value)}
                               variant="standard" />
                </Grid>
            </Grid>
            <Grid container columns={{xs: 1, sm:1, md: 1, lg: 2}} spacing={4}>
                   <Grid item xs={1}>
                         <h3>My Datasets</h3>
                         { mySessions.length
                            ? sessionTable(mySessionsFiltered, true) 
                            : <div>You have not created any GYDE datasets yet.  Click "New dataset" to make one.</div>}
                    </Grid>
                    <Grid item xs={1}>
                         <h3>Shared Datasets</h3>
                         { sharedSessions.length 
                            ? sessionTable(sharedSessionsFiltered, false)
                            : <div>No datasets shared with you</div> }
                    </Grid>
            </Grid>
        </ThemeProvider>
    );
}

function filterSessions(sessions=[], filter) {
    if (!filter || filter.length < 3) return sessions;
    const lcFilter = filter.toLowerCase();

    return sessions.filter((s) => 
        (s.name || '').toLowerCase().indexOf(lcFilter) >= 0 ||
        (s._gyde_readonly && s.user_name.toLowerCase().indexOf(lcFilter) >= 0) ||
        (s.description && s.description.toLowerCase().indexOf(lcFilter) >= 0));
}


function SessionFieldEditor({init, onEditFinished}) {
    const [content, setContent] = useState(init);

    const onFieldChange = useCallback((ev) => {
        setContent(ev.target.value);
    }, [setContent]);

    const onKeyPress = useCallback((ev) => {
        if (ev.code === 'Enter') {
            onEditFinished(content);
        } else if (ev.code === 'Escape') {
            onEditFinished();
        }
    }, [content, onEditFinished]);

    return (
        <div>
            <TextField style={{width: '100%'}}
                       autoFocus
                       value={content}
                       onChange={onFieldChange} 
                       onKeyDown={onKeyPress} />
        </div>
    );
}

function getSID(el) {
    if (el.dataset?.sid) return el.dataset.sid;
    if (el.parentElement) return getSID(el.parentElement);
}
