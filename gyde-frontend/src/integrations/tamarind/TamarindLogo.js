import React from 'react';
import logo from './tamarind-icon.svg';

export default function TamarindLogo() {
    return <img src={logo} alt="Tamarind Bio" title="Tamarind Bio"
        style={{height:'1.1em',width:'0.92em',objectFit:'contain',verticalAlign:'-0.15em',marginLeft:'0.4em',flexShrink:0}}/>;
}
