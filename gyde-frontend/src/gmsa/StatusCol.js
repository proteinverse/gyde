import React, {useCallback, useMemo} from 'react';
import {CircularProgress, IconButton, Tooltip} from '@mui/material';
import {Visibility, Cancel} from '@mui/icons-material';

import CellularCol from './CellularCol';

function StatusCell({data, index, updateSelection, format}) {
    const clickHandler = useCallback((ev) => {
        ev.preventDefault(); ev.stopPropagation();

        if (index !== undefined) {
            if (updateSelection) {
                updateSelection({
                    op: (ev.ctrlKey || ev.metaKey) 
                    ? 'toggle'
                    : ev.shiftKey
                      ? 'extend'
                      : 'set', 
                    item: parseInt(index)
                });
            }
        }
    }, [updateSelection, index]);


    let handler = data?.onClick;
    let onCancel = data?.onCancel;
    let message = data?.message;
    let content;
    let status = data?.status ?? data;

    if (status === true) {
        content =<span style={{color: 'green'}}>{ '\u2713' }</span>;
    } else if (status === false) {
        content = (
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                <CircularProgress size={8} />
                { handler
                    ? <Tooltip title="View job">
                          <IconButton size="small"
                                      onClick={(ev) => {ev.preventDefault(); ev.stopPropagation(); handler()}}
                                      sx={{padding: '2px', color: 'primary.main'}}>
                              <Visibility sx={{fontSize: 14}} />
                          </IconButton>
                      </Tooltip>
                    : undefined }
                { onCancel
                    ? <Tooltip title="Cancel job">
                          <IconButton size="small"
                                      onClick={(ev) => {ev.preventDefault(); ev.stopPropagation(); onCancel()}}
                                      sx={{padding: '2px', color: 'error.main'}}>
                              <Cancel sx={{fontSize: 14}} />
                          </IconButton>
                      </Tooltip>
                    : undefined }
            </span>
        );
    } else if (status === 'import_waiting') {
        content = <span style={{color: '#9a6700'}}>Import pending</span>;
    } else if (status) {
        if (typeof(data) === 'string') {
            message = data;
        } else {
            message = data.message;
        }
        content = <span style={{color: 'red'}}>{ '\u2717' }</span>;
    }

    if (status !== false && handler) {
        content = (
            <a href="#" 
               onClick={(ev) => {ev.preventDefault(); ev.stopPropagation(); handler()}}
               style={{textDecoration: 'none'}}>
                {content}
            </a>
        )
    }
    if (message) {
        content = (
            <Tooltip title={'' + message}>
                {content}
            </Tooltip>
        );
    }

    return (
        <div 
            style={{
                marginTop: 'auto',
                marginBottom: 'auto',
                whiteSpace: 'nowrap',
                width: '100%',
                padding: 3,
                userSelect: 'none'
            }}
            onClick={(handler || onCancel) ? undefined : clickHandler}
        >
            { content }
        </div>
    );
}

export default function StatusCol(props) {
    return (
        <CellularCol CellComponent={StatusCell}
                     {...props} />
    );
}
