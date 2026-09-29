export async function loadStructureModel(viewer, trajectory, label, {modelIndex} = {}) {
    const preset = await viewer.plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default',
        modelIndex == null ? undefined : {model:{modelIndex}});
    // The hierarchy may still be updating, or another structure may be loading.
    // The returned selector identifies this exact model without timers or array ordering.
    const model = preset?.model;
    if (!model?.cell?.obj?.data) {
        throw Error('The structure contains no readable model. Check the file and selected model index.');
    }
    model.cell.obj.data.label = label;
    return model;
}
