**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [公用变量](#公用变量)
    - [isReservedProp](#isreservedprop)
- [渲染器](#渲染器)
    - [参数](#参数)
- [对比方法](#对比方法)
    - [patchElement](#patchelement)
    - [patchProps](#patchprops)
- [执行操作方法](#执行操作方法)
    - [process前置说明](#process前置说明)
    - [processElement](#processelement)
    - [processText](#processtext)
- [挂载阶段](#挂载阶段)
    - [mountElement](#mountelement)
    - [mountChildren](#mountchildren)

<!-- /TOC -->

# 公用变量  
## isReservedProp  
这个变量存储的是 Vue 内置的 prop，遇到这些 prop 的时候，并不会对其进行处理（ 设置真实节点的属性 ）  

```typescript
const isReservedProp = /*#__PURE__*/ makeMap(
    'key,ref,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted'
)
```  

解析后如下  
```typescript
const isReservedProp = {
    key: true,
    ref: true,
    onVnodeBeforeMount: true,
    onVnodeMounted: true,
    onVnodeBeforeUpdate: true,
    onVnodeUpdated: true,
    onVnodeBeforeUnmount: true,
    onVnodeUnmounted: true,
}
```  

# 渲染器  
Vue3.0 支持自定义渲染器，用来在不同平台上进行节点的渲染，首先需要创建一个渲染器，并且提供在不同平台上操作节点的一系列函数，具体如下  

```typescript
function baseCreateRenderer (
    options: RendererOptions,
    createHydrationFns?: typeof createHydrationFunctions
) {
    // 获取不同平台下对节点的操作
    const {
        insert: hostInsert,                             // 插入
        remove: hostRemove,                             // 移除
        patchProp: hostPatchProp,                       // 比较 props
        createElement: hostCreateElement,               // 创建元素节点
        createText: hostCreateText,                     // 创建文本节点
        createComment: hostCreateComment,               // 创建注释节点
        setText: hostSetText,                           // 设置属性节点
        setElementText: hostSetElementText,             // 设置节点文本内容
        parentNode: hostParentNode,                     // 获取父界节点
        nextSibling: hostNextSibling,                   // 获取下一个兄弟节点
        setScopeId: hostSetScopeId = NOOP,              
        cloneNode: hostCloneNode,                       // 克隆节点
        insertStaticContent: hostInsertStaticContent    
    } = options

    // 接下来定义了一系列的操作方法  
    
    const patch = ( /**/ ) => { /**/ }
    const patchElement = ( /**/ ) => { /**/ }
    const patchBlockChildren = ( /**/ ) => { /**/ }
    const patchProps = ( /**/ ) => { /**/ }
    const patchChildren = ( /**/ ) => { /**/ }
    const patchUnkeyedChildren = ( /**/ ) => { /**/ }
    const patchKeyedChildren = ( /**/ ) => { /**/ }

    const processElement = ( /**/ ) => { /**/ }
    const processText = ( /**/ ) => { /**/ }
    const processCommentNode = ( /**/ ) => { /**/ }
    const processFragment = ( /**/ ) => { /**/ }
    const processComponent = ( /**/ ) => { /**/ }

    const mountElement = ( /**/ ) => { /**/ }
    const mountChildren = ( /**/ ) => { /**/ }
    const mountComponent = ( /**/ ) => { /**/ }
    const mountStaticNode = ( /**/ ) => { /**/ }

    const unmount = ( /**/ ) => { /**/ }
    const unmountChildren = ( /**/ ) => { /**/ }
    const unmountComponent = ( /**/ ) => { /**/ }

    const updateComponent = ( /**/ ) => { /**/ }
    const updateComponentPreRender = ( /**/ ) => { /**/ }

    const setupRenderEffect = ( /**/ ) => { /**/ }

    const setRef = ( /**/ ) => { /**/ }

    const getNextHostNode = ( /**/ ) => { /**/ }

    const move = ( /**/ ) => { /**/ }

    const remove = ( /**/ ) => { /**/ }
    const removeFragment = ( /**/ ) => { /**/ }
    const removeFragment = ( /**/ ) => { /**/ }

    const render = ( /**/ ) => { /**/ }

    return {
        render,
        hydrate,
        createApp: createAppAPI(render, hydrate)
    }
}
```  

## 参数  
对于上面的几个操作内，基本都有共同的参数，接下来会说明参数的意义，在每一次渲染都会调用，所以存在 “第一次” 和 “非第一次” 两种情况  

1. `n1`: 老节点，是一个 `vNode` 对象，如果是第一次则为 `null`  
2. `n2`: 新节点，是一个 `vNode` 对象  
3. `container`: 父节点，是一个真实的节点，如果在浏览器环境就是 `DOM` 节点，如果当前渲染的是根节点，那么它就是容器节点，如果当前渲染的是某个子节点，那么它就是父节点  
4. `anchor`: 在插入节点会用到  
    如果它不存在，插入的时候会把 `n2` 对应的真实节点插入到 `container` 内最后一个，如果它存在，则会插入到 `anchor` 前面  

# 对比方法  

## patchElement  
这个方法只会在 `processElement` 内调用，且新老节点属于同一类型的节点  

```typescript
const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    // 此时新老 vnode 属于相同的节点，所以可以复用老的真实节点
    const el = (n2.el = n1.el!)
    // 获取新节点的相关属性
    let { patchFlag, dynamicChildren, dirs } = n2
    // 获取新老节点的 props
    const oldProps = (n1 && n1.props) || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    // 处理 before update 钩子
    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
        invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    
    if (dirs) {
        invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }

    if (patchFlag > 0) {

    } else if (!optimized && dynamicChildren == null) {
        // 未优化，需要全量对比 props
        patchProps(
            el,
            n2,
            oldProps,
            newProps,
            parentComponent,
            parentSuspense,
            isSVG
        )
    }

    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'

    if (dynamicChildren) {

    } else if (!optimized) {
        // 未优化，全量比较 children
        patchChildren(
            n1,
            n2,
            el,
            null,
            parentComponent,
            parentSuspense,
            areChildrenSVG
        )
    }

    // 处理 updated 钩子
    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
        queuePostRenderEffect(() => {
            vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
            dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
        }, parentSuspense)
    }
}
```  

## patchProps  
这个方法用来比较前后两次渲染 `props` 的变化，并设置到真实节点，只会在 [patchElement](#patchElement)` 中调用，所以新老节点是可以复用的  

```typescript
const patchProps = (
    el: RendererElement,                                // 复用的老节点 
    vnode: VNode,                                       // 新的 vnode
    oldProps: Data,                                     // 老节点的 props
    newProps: Data,                                     // 新节点的 props
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
) => {
    // 如果前后两次 props 没有变化，则不作任何处理
    if (oldProps !== newProps) {
        // 遍历新的 props
        for (const key in newProps) {
            // 过滤内置 prop
            if (isReservedProp(key)) continue
            const next = newProps[key]
            const prev = oldProps[key]
            // 同一 prop 前后两次不相同，则设置真实节点的属性值
            if (next !== prev) {
                hostPatchProp(
                    el,
                    key,
                    prev,
                    next,
                    isSVG,
                    vnode.children as VNode[],
                    parentComponent,
                    parentSuspense,
                    unmountChildren
                )
            }
        }

        if (oldProps !== EMPTY_OBJ) {
            // 遍历老的 props
            for (const key in oldProps) {
                // 过滤内置 prop 以及不属于新的 props
                if (!isReservedProp(key) && !(key in newProps)) {
                    hostPatchProp(
                        el,
                        key,
                        oldProps[key],
                        null,
                        isSVG,
                        vnode.children as VNode[],
                        parentComponent,
                        parentSuspense,
                        unmountChildren
                    )
                }
            }
        }
    }
}
```

# 执行操作方法  
执行操作方法都是以 `process` 开头，是处理渲染节点的入口函数，但具体是第一次渲染（ 需要挂载 ），还是非第一次渲染（ 需要比较新老节点的差异 ），则会由其他函数执行，`process` 函数里只做一个判断  

## process前置说明  
下面几个 `process` 方法都是在 [patch]($patch) 函数内部调用的，而在 [patch]($patch) 内一开始，就会判断新老节点是否属于同一节点  
如果不属于同一节点，那么会将 `n1` 设置为 `null`，代表本次渲染的是一个新的节点，没有老节点，所以之后 `process` 内都会走挂载流程  
如果属于同一节点，之后的 `process` 内会走更新流程，而且更新流程内是可以直接复用老的真实节点的，它们属于同一类型的节点  

## processElement  

```typescript
const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    // TODO
    // 检测当前渲染的节点是否是 svg 节点
    isSVG = isSVG || ( n2.type as string ) === 'svg';

    if ( n1 == null ) {
      // 不存在老节点，说明是第一次渲染，进行挂载
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      );
    } else {
      // 非第一次渲染，进行 patchElement 新老节点
      patchElement( n1, n2, parentComponent, parentSuspense, isSVG, optimized );
    }
}
```  

## processText  

```typescript
type ProcessTextOrCommentFn = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null
) => void
const processText: ProcessTextOrCommentFn = ( n1, n2, container, anchor ) => {
    if ( n1 == null ) {
        // 不存在老节点，第一次渲染，需要挂载
        // 在不同平台下，创建文本节点，并挂载 vnode 的 el 上
        // 在不同平台下，将创建的文本节点插入父节点中
        hostInsert(
            (n2.el = hostCreateText( n2.children as string )),
            container,
            anchor
        )
    } else {
        // ①
        // 非第一次渲染，因为文本节点只有内容，没有其他的 props
        // 所以直接复用老的真实节点，而且只有文本内容不一致时，才会更新真实节点的内容为新的内容
        const el = (n2.el = n1.el!)
        if ( n2.children !== n1.children ) {
            // 如果文本内容不相同，则重新设置文本
            hostSetText( el, n2.children as string )
        }
    }
}
```  

① 处直接复用老节点的原因可以参考 [process前置说明](#process前置说明)  

# 挂载阶段  

## mountElement  
这个函数用来创建元素节点，并挂载到父元素上，只有在 `processElement` 内部才会调用，所以有两种情况  
1. 当前渲染的节点是第一次  
2. 当前渲染的节点不是第一次，而且老节点和新节点不是同一类型的节点，参考 [process前置说明](#process前置说明)  

```typescript
const mountElement = (
    vnode: VNode,                                       // 即将挂载的新节点
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    // 获取新节点的相关属性
    const {
        type,
        props,
        shapeFlag,
        transition,
        scopeId,
        patchFlag,
        dirs
    } = vnode

    if (
      vnode.el &&
      hostCloneNode !== undefined &&
      patchFlag === PatchFlags.HOISTED
    ) {
        el = vnode.el = hostCloneNode( vnode.el )
    } else {
        // 创建各个平台中的真实节点并挂载到 vnode 的 el 上
        el = vnode.el = hostCreateElement(
            vnode.type as string,
            isSVG,
            props && props.is
        );

        if (props) {
            for (const key in props) {
                // 过滤掉 isReservedProp 中的属性
                if (!isReservedProp(key)) {
                    // 在不同平台下，设置真实节点的各个属性值
                    hostPatchProp(el, key, null, props[key], isSVG)
                }
            }

            // 处理 before mount 钩子
            if ((vnodeHook = props.onVnodeBeforeMount)) {
                invokeVNodeHook(vnodeHook, parentComponent, vnode)
            }
        }

        if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
        }

        if (scopeId) {
            hostSetScopeId(el, scopeId)
        }

        const treeOwnerId = parentComponent && parentComponent.type.__scopeId

        if (treeOwnerId && treeOwnerId !== scopeId) {
            hostSetScopeId(el, treeOwnerId + '-s')
        }

        // 处理子节点
        if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
            // 子节点是文本，例如 <div>hello</div>
            // 在不同平台上，将真实节点 el 的内容设置为该文本
            hostSetElementText(el, vnode.children as string)
        } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            ①
            // 子节点是列表，例如 <div><span>hello</span></div>
            // 挂载所有的子节点到新创建的 el 节点
            mountChildren(
                vnode.children as VNodeArrayChildren,
                el,
                null,
                parentComponent,
                parentSuspense,
                isSVG && type !== 'foreignObject',
                optimized || !!vnode.dynamicChildren
            )
        }

        if (transition && !transition.persisted) {
            transition.beforeEnter(el)
        }
    }

    // 此时，已经将 el 的 props，以及子节点都挂载到了 el 上，所以调用不同平台的插入操作，将 el 插入到 container 中
    hostInsert(el, container, anchor)

    if (
        (vnodeHook = props && props.onVnodeMounted) ||
        (transition && !transition.persisted) ||
        dirs
    ) {
        queuePostRenderEffect(() => {
            vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
            transition && !transition.persisted && transition.enter(el)
            dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
    }
    
}
```  

1. ① 处调用 `mountChildren` 时，第三个参数（ 即 `anchor` ）传递的是 `null`，也就是说，当挂载节点的子节点是一个列表时，那么这些子节点会依次追加到 `el` 里的最后一个，保证和原始列表顺序一致，不会发生在某个节点中间插入的情况  

## mountChildren  
这个函数用来挂载子节点列表  

```typescript
const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    start = 0
) => {
    for (let i = start; i < children.length; i++) {
        const child = (children[i] = optimized
            ? cloneIfMounted(children[i] as VNode)
            : normalizeVNode(children[i]))
        // 
        patch(
            null,
            child,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    }
}
```