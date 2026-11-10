/* 移植自 Folia components/visualizer/pixi/pixiDisplayResources.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const unloadPixiDisplayTree = (root)=>{
    const stack = [
        ...root.children ?? []
    ];
    while(stack.length > 0){
        const node = stack.pop();
        if (node.children?.length) stack.push(...node.children);
        node.context?.unload?.();
        node.unload?.();
    }
};
export const setPixiDisplayTreeVisibility = (root, visible)=>{
    const wasVisible = root.visible !== false;
    root.visible = visible;
    if (wasVisible && !visible) unloadPixiDisplayTree(root);
};
export const destroyPixiDisplayTree = (root)=>{
    const order = [];
    const stack = [
        root
    ];
    while(stack.length > 0){
        const node = stack.pop();
        order.push(node);
        if (node.children?.length) stack.push(...node.children);
    }
    for(let index = order.length - 1; index >= 0; index -= 1)order[index].destroy?.();
};
export const destroyPixiContainerChildren = (container)=>{
    container.removeChildren().forEach(destroyPixiDisplayTree);
};
