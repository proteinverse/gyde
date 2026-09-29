import {isTamarindCompute} from '../compute';
import React from 'react';

export {SlivkaServiceContext, WithSlivkaService, useSlivka, useSlivkaService} from './SlivkaService';

import {ServiceLauncher as RawServiceLauncher} from './App';
import {JobView as RawJobView} from './App';
export {configMapToFormData} from './App';
export {RawServiceLauncher, RawJobView};

import Styled from './Styled';

export function ServiceLauncher(props) {
    // MUI injects its styles into the document. The legacy Bootstrap shadow
    // root isolates those styles and leaves hosted controls unstyled.
    if (isTamarindCompute()) return <RawServiceLauncher {...props} />;
    return (
        <Styled>
            <RawServiceLauncher {...props} />
        </Styled>
    );
}

export function JobView(props) {
    return (
        <Styled>
            <RawJobView {...props} />
        </Styled>
    );
}
