> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [processFragment](#processfragment)
- [patchUnkeyedChildren](#patchunkeyedchildren)

<!-- /TOC -->

# processFragment  
这个函数是处理 `Fragment` 的入口函数，因为 `Fragment` 并不会实际渲染出来，所以源码中会通过两个文本节点来标记 `Fragment` 的范围，只要是 `Fragment` 的子节点，都会存在于这两个文本节点之间  

开始的文本节点称为 `fragmentStartAnchor`，会被挂载到 `Fragment` 对应 `vnode` 的 `el` 上  
结束的文本节点称为 `fragmentEndAnchor`，会被挂载到 `Fragment` 对应 `vnode` 的 `anchor` 上   

因为 `Fragment` 并不是一个组件，所以它内部使用的还是元素的处理方式  

```typescript
const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    // 创建开始/结束文本节点，如果是挂载节点，则新创建一个；如果是更新节点，则复用老 vnode 的文本节点
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren } = n2

    // 如果 Fragment 的 patchFlag 有值，则开始优化模式
    if (patchFlag > 0) {
        optimized = true
    }

    if (n1 == null) {
        // 挂载
        // 第一步将两个文本节点挂载到容器内
        hostInsert(fragmentStartAnchor, container, anchor)
        hostInsert(fragmentEndAnchor, container, anchor)
        // 第二步挂载子 children，注意第三个参数，会将所有的子节点挂载在 结束文本 之前
        mountChildren(
            n2.children as VNodeArrayChildren,
            container,
            fragmentEndAnchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    } else {
        // 更新
        if (
            patchFlag > 0 &&
            patchFlag & PatchFlags.STABLE_FRAGMENT &&
            dynamicChildren
        ) {
            // 对于 stable 的 Fragment 来说，只需要处理动态 children 即可
            patchBlockChildren(
                n1.dynamicChildren!,
                dynamicChildren,
                container,
                parentComponent,
                parentSuspense,
                isSVG
            )
            if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
                traverseStaticChildren(n1, n2)
            } else if (
                // #2080 if the stable fragment has a key, it's a <template v-for> that may
                //  get moved around. Make sure all root level vnodes inherit el.
                // #2134 or if it's a component root, it may also get moved around
                // as the component is being moved.
                n2.key != null ||
                (parentComponent && n2 === parentComponent.subTree)
            ) {
                traverseStaticChildren(n1, n2, true /* shallow */)
            }
        } else {
            // 对于非 stable Fragment，需要处理全部的 children
            patchChildren(
                n1,
                n2,
                container,
                fragmentEndAnchor,
                parentComponent,
                parentSuspense,
                isSVG,
                optimized
            )
        }
    }
}
```   

**总结：对于 `Fragment` 的更新，是更新全部 `children` 还是动态 `children` 取决于是否是 `STABLE_FRAGMENT`；是否开启优化模式取决于是否存在 `patchFlag`**  

# patchUnkeyedChildren  
这个函数用来更新没有 `key` 的 `Fragment` 子 `children`  
其中 `anchor` 参数就是这个 `Fragment` 的结束文本节点，所以如果有需要挂载的新节点，都会挂载在结束文本之前  

```typescript
const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    // 获取新旧最小长度，以便遍历公共部分
    const commonLength = Math.min(oldLength, newLength)
    
    for (let i = 0; i < commonLength; i++) {
        const nextChild = (c2[i] = optimized
            ? cloneIfMounted(c2[i] as VNode)
            : normalizeVNode(c2[i]))
        patch(
            c1[i],
            nextChild,
            container,
            null,       // TODO: 为什么 anchor 传递为 null
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    }
    
    if (oldLength > newLength) {
        // 移除老的节点，这里卸载的时候使用了非优化模式，会将所有的子节点都卸载
        unmountChildren(
            c1,
            parentComponent,
            parentSuspense,
            true,
            false,
            commonLength
        )
    } else {
        // 挂载新的节点
        mountChildren(
            c2,
            container,
            anchor,           // 这里挂载新的节点，还是挂载在 Fragment 的 end anchor 之前
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            commonLength
        )
    }
}
```  

**可以看到，对于没有 `key` 的 `children` 来说，没有复用任何一个节点，在 `patch` 每个节点的时候，如果不是同一类型的节点，就会先移除再创建**