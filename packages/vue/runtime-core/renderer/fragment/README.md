> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [processFragment](#processfragment)
- [示例](#示例)
    - [UNKEYED_FRAGMENT](#unkeyed_fragment)
    - [STABLE_FRAGMENT](#stable_fragment)

<!-- /TOC -->

# processFragment  
这个函数是处理 `Fragment` 的入口函数，我们知道 `Fragment` 并不会实际渲染到 `DOM` 中，所以源码中会通过两个文本节点来标记 `Fragment` 的范围，只要是 `Fragment` 的子节点，都会存在于这两个文本节点之间  

开始的文本节点称为 `fragmentStartAnchor`，会被挂载到 `Fragment` 对应 `vnode` 的 `el` 上  
结束的文本节点称为 `fragmentEndAnchor`，会被挂载到 `Fragment` 对应 `vnode` 的 `anchor` 上，在 `patch` `children` 的时候，参数 `anchor` 就是 `fragmentEndAnchor`，使得所有的 `children` 都会挂载到 `fragmentEndAnchor` 之前  

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

    // 如果 Fragment 的 patchFlag 有值，则开启优化模式
    if (patchFlag > 0) {
        optimized = true
    }

    if (n1 == null) {
        // 挂载
        // 1. 将两个文本节点挂载到容器内
        hostInsert(fragmentStartAnchor, container, anchor)
        hostInsert(fragmentEndAnchor, container, anchor)
        // 2. 挂载 children，注意第三个参数，会将所有的子节点挂载在 结束文本 之前
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

# 示例  

## UNKEYED_FRAGMENT  

```typescript
const root = document.createElement( 'div' );

// 1
render(createVNode(
    Fragment,
    null,
    [
        (openBlock(), createBlock('div', null, [
            createVNode('span', null, 'one', PatchFlags.TEXT),
            createVNode('i', null, 'bar'),
        ]))
    ],
    PatchFlags.UNKEYED_FRAGMENT
), root);

// 2
render(createVNode(
    Fragment,
    null,
    [
        (openBlock(), createBlock('div', null, [
            createVNode('span', null, 'two', PatchFlags.TEXT),
            createVNode('i', null, 'bar'),
        ]))
    ],
    PatchFlags.UNKEYED_FRAGMENT
), root);
```  

在第二步更新 Fragment 时，会由 [processFragment](#processFragment) -> [patchChildren](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchChildren) -> [patchUnkeyedChildren](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchunkeyedchildren) 这一系列的调用，最终在 [patchUnkeyedChildren](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchunkeyedchildren) 处理（ 并且此时是开启了优化更新 ），在 `patch` `div` 时，由于开启了优化且存在动态子节点，所以只会对 `span` 处理，而不会对 `i` 处理  

这个示例对 `KEYED_FRAGMENT` 的 `Fragment` 也适用，只不过最终是在 [patchKeyedChildren](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/element/children/README.md#patchkeyedchildren) 中处理  

## STABLE_FRAGMENT  

```html
<p>this is static text.</p>
<p>{{ text }}</p>
```  

会被编译为  

```typescript
(_openBlock(), _createBlock(_Fragment, null, [
    _createVNode("p", null, "this is static text."),
    _createVNode("p", null, _toDisplayString(_ctx.text), 1 /* TEXT */)
], 64 /* STABLE_FRAGMENT */))
```  

可以看到，最外面是一个 `STABLE_FRAGMENT` 的 `Fragment`，如果发生了更新，那么在 [processFragment](#processFragment) 中只会处理动态 `children`，也就是第二个 `p` 标签，第一个静态的是不会处理的  
