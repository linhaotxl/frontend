> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [patch](#patch)
- [示例](#示例)
    - [patch 不同节点，获取兄弟节点](#patch-不同节点获取兄弟节点)

<!-- /TOC -->

# patch  
这是对节点处理的入口方法，不管是挂载、新增还是移除，都会从这个方法开始，主要做三件事  
1. 如果是更新过程，需要卸载老节点，挂载新节点  
2. 调用不同节点的处理方法，进行不同的处理  
3. 处理 `ref`，这个时候节点已经处理完成了，所以可以进行 `ref` 的设置  

```typescript
/**
 * @param n1 老节点
 * @param n2 新节点
 * @param container 父节点
 * @param anchor 
 * @param parentComponent   父组件实例
 * @param parentSuspense 
 * @param isSVG 
 * @param optimized  
 */
const patch: PatchFn = (
    n1,
    n2,
    container,
    anchor = null,
    parentComponent = null,
    parentSuspense = null,
    isSVG = false,
    optimized = false
) => {
    // 检测新旧节点是否相同
    if (n1 && !isSameVNodeType(n1, n2)) {
        // 新旧节点不相同
        anchor = getNextHostNode(n1)
        // 直接卸载旧节点，第四个参数表示会移除 n1 所对应的真实 DOM
        unmount(n1, parentComponent, parentSuspense, true)
        // 将 n1 重置为 null，之后会走挂载的流程
        n1 = null
    }

    if (n2.patchFlag === PatchFlags.BAIL) {
        optimized = false
        n2.dynamicChildren = null
    }

    const { type, ref, shapeFlag } = n2

    // 检测新节点类型，不同类型有不同的处理方法
    switch (type) {
        // 文本节点
        case Text:
            processText(n1, n2, container, anchor)
            break
        // 注释节点
        case Comment:
            processCommentNode(n1, n2, container, anchor)
            break
        // 静态节点
        case Static:
            if (n1 == null) {
                mountStaticNode(n2, container, anchor, isSVG)
            } else if (__DEV__) {
                patchStaticNode(n1, n2, container, isSVG)
            }
            break
        // Fragment 节点
        case Fragment:
            processFragment(
                n1,
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                isSVG,
                optimized
            )
            break
        default:
            // 元素节点
            if (shapeFlag & ShapeFlags.ELEMENT) {
                processElement(
                    n1,
                    n2,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    isSVG,
                    optimized
                )
            }
            // 组件节点
            else if (shapeFlag & ShapeFlags.COMPONENT) {
                processComponent(
                    n1,
                    n2,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    isSVG,
                    optimized
                )
            }
            // Telport 节点
            else if (shapeFlag & ShapeFlags.TELEPORT) {
                ;(type as typeof TeleportImpl).process(
                    n1 as TeleportVNode,
                    n2 as TeleportVNode,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    isSVG,
                    optimized,
                    internals
                )
            }
            // Suspense 节点
            else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
                ;(type as typeof SuspenseImpl).process(
                    n1,
                    n2,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    isSVG,
                    optimized,
                    internals
                )
            } else if (__DEV__) {
                warn('Invalid VNode type:', type, `(${typeof type})`)
            }
    }

    // 设置 ref，这个地方只会处理两种情况，挂载和更新
    // 而卸载情况的 ref 已经在上面通过 unmount 处理过了
    if (ref != null && parentComponent) {
        setRef(ref, n1 && n1.ref, parentComponent, parentSuspense, n2)
    }
}
```

可以看到，在第二件事里，针对不同类型的节点，会调用相关类型节点的处理方法，这些方法都是以 `process` 开头的，这些方法的作用大致相同，就是处理挂载和更新两种情况，  至于卸载，已经在第一件事里做好了  
判断挂载还是更新，主要就是看旧节点 `n1` 是否存在，存在就是更新，否则就是挂载  

# 示例  

## patch 不同节点，获取兄弟节点  

```typescript
const list = [{ tag: 'p', text: 'foo' }]
render(
    (openBlock(true),
    (block = createBlock(
        Fragment,
        null,
        list.map(item => {
            return createVNode(item.tag, null, item.text)
        }),
        PatchFlags.UNKEYED_FRAGMENT
    ))),
    root
)

list.unshift({ tag: 'i', text: 'bar' })
render(
    (openBlock(true),
    createBlock(
        Fragment,
        null,
        list.map(item => {
            return createVNode(item.tag, null, item.text)
        }),
        PatchFlags.UNKEYED_FRAGMENT
    )),
    root
)
```

1. 在更新时，由于 `Fragment` 是 `UNKEYED_FRAGMENT`，所以会通过 [patchUnkeyedChildren](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchunkeyedchildren) 来处理子元素  
2. `patch` 第一个元素时，旧 `vnode` 是 `p`，新 vnode 是 `i`，由于类型不同，所以会去查找 `p` 的兄弟节点，即 `Fragment` 的结束文本标签，所以接下来会将 `i` 插入到结束文本标签之前  



## PatchFlags.BAIL 作用  

```typescript
render(
    (openBlock(),
     (block = createBlock('div', null, [createVNode('p', null, 'foo')]))),
    root
);

console.log( root.children[0].innerHTML === '<div><p>foo</p></div>' );	// true

render(
    (openBlock(),
     (block = createBlock(
        'div',
        null,
        [createVNode('i', null, 'bar')],
        PatchFlags.BAIL
    ))),
    root
);

console.log( root.children[0].innerHTML === '<div><i>foo</i></div>' );	// true
```

1. 在更新 `div` 时，由于 `div` 是 `block`，所以它的 `dynamicChildren` 会是一个空数组，而此时，他的 `patchFlag` 是 `BAIL`，所以会将 `dynamicChildren` 设置为 `null`，以供能在 [patchElement](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchElement) 中对 `children` 进行处理，否则它的 `children` 都会不会变了

