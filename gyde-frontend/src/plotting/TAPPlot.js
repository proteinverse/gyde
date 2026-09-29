import React from 'react';
import * as d3 from 'd3';
import {withResizeDetector} from 'react-resize-detector';
import {Axis, Orient} from 'd3-axis-for-react';

class TAPPlot extends React.Component {
    static defaultProps = {
        plotWidth: 200,
        plotHeight: 150,
        marginLeft: 30, 
        marginRight: 20,
        marginTop: 20,
        marginBottom: 30,
        dynamicWidth: false,
        dynamicHeight: false,
        xPxPerTick: 60,
        yPxPerTick: 60
    }

    render() {
        const {data: plotData, xPxPerTick, yPxPerTick,
               marginLeft, marginRight, marginBottom, marginTop} = this.props;
        if (!plotData) return (<div>Nothing here</div>);

        if (plotData.tamarindMetric) {
            const {name,value,flag}=plotData.tamarindMetric;
            return <div style={{padding:16}}>
                <strong>{name}</strong>
                <div style={{fontSize:24,margin:'8px 0'}}>{Number(value.toPrecision(5))}</div>
                {flag && <div>{flag}</div>}
                <small>TAP2-aligned developability score from Tamarind.</small>
            </div>;
        }

        const width = (this.props.dynamicWidth && this.props.width) ? this.props.width - marginLeft - marginRight: this.props.plotWidth,
              height = (this.props.dynamicHeight && this.props.height) ? this.props.height - marginTop - marginBottom : this.props.plotHeight;

        const data = plotData.data,
              axis = plotData.axes[0];

        const xScale = d3.scaleLinear()
            .range([0, width])
            .domain(axis.xdomain);
        const yScale = d3.scaleLinear()
            .range([height, 0])
            .domain(axis.ydomain);

        const bottomAxis = axis.axes.filter((a) => a.position === 'bottom')[0],
              leftAxis = axis.axes.filter((a) => a.position === 'left')[0];

        function path(codes, xi, yi, data) {
            let cursor = 0;
            return codes.map((c) => {
                if (c !== 'Z') {
                    return `${c}${xScale(data[cursor][xi])},${yScale(data[cursor++][yi])}`;
                } else {
                    return c;
                }
            }).join(' ');
        }

        return (
            <div style={{width: '100%'}} ref={this.props.targetRef}>
                <svg width={ marginLeft + width + marginRight }
                     height={ marginTop + height + marginBottom }>
                    <g transform={`translate(${marginLeft}, ${marginTop})`}>
                        { axis.paths.map((pathDef, i) => (
                            <path key={i}
                                  stroke={pathDef.edgecolor}
                                  fill={pathDef.facecolor}
                                  alpha={pathDef.alpha}
                                  strokeDasharray={pathDef.dasharray}
                                  strokeWidth={pathDef.edgewidth}
                                  d={path(pathDef.pathcodes, pathDef.xindex, pathDef.yindex, data[pathDef.data])} />
                        )) }
                        { axis.lines.map((lineDef, i) => (
                            <line key={i}
                                  stroke={lineDef.color}
                                  strokeWidth={lineDef.linewidth}
                                  strokeDasharray={lineDef.dasharray}
                                  x1={xScale(data[lineDef.data][0][lineDef.xindex])} 
                                  y1={yScale(data[lineDef.data][0][lineDef.yindex])}
                                  x2={xScale(data[lineDef.data][1][lineDef.xindex])} 
                                  y2={yScale(data[lineDef.data][1][lineDef.yindex])} />
                        ))}
                    </g>
                    <g transform={`translate(${marginLeft}, ${marginTop})`}>
                        { leftAxis && 
                            <Axis orient={Orient.left}
                                  scale={yScale}
                                  ticks={[Math.ceil(width/yPxPerTick)]} /> }
                    </g>
                    <g transform={`translate(${marginLeft}, ${marginTop+height})`}>
                        { bottomAxis &&
                            <Axis orient={Orient.bottom}
                                  scale={xScale}
                                  ticks={[Math.ceil(width/xPxPerTick)]} /> }
                    </g>
                </svg>
            </div>
        )
    }
}

export default withResizeDetector(TAPPlot);