> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [Teleport 基本介绍](#teleport-基本介绍)
    - [Teleport 的 vnode 节点](#teleport-的-vnode-节点)
    - [Teleport 的 props](#teleport-的-props)
        - [to](#to)
        - [disabled](#disabled)
- [Teleport 实现](#teleport-实现)
    - [isTeleport](#isteleport)
    - [isTeleportDisabled](#isteleportdisabled)
    - [resolveTarget](#resolvetarget)
    - [TeleportImpl](#teleportimpl)
        - [process](#process)
        - [moveTeleport](#moveteleport)
        - [remove](#remove)
- [补充](#补充)
    - [targetAnchor](#targetanchor)

<!-- /TOC -->

# Teleport 基本介绍  

## Teleport 的 vnode 节点
每个 `Teleport` 组件都会产生两个标记范围的节点，分别对应 `vnode` 的 `el` 和 `anchor`  
* `el`: 是一个注释节点，称为 *teleport start*  
* `anchor`: 是一个注释节点，称为 *teleport end*  

会将这两个节点插入到 `Teleport` 所在的位置上占位，表示这是一个 `Teleport` 组件，而将 `children` 插入到 `to` 所指的节点中 `target` 里  

在 `target` 里，还会创建一个新的 `anchor` 节点，称为 `targetAnchor`，所有的 `children` 都会插入到 `targetAnchor` 的前面  

## Teleport 的 props  

### to  
`to` 属性表示实际将 `children` 挂载到其中的节点，可以有两种类型  
1. 字符串，直接被用作 `document.querySelector` 的参数  
2. DOM 对象  

### disabled  
`disabled` 表示 `Teleport` 组件是否被禁用，如果被禁用的话，那么 `Teleport` 就和普通的组件一样，会将 `children` 挂载在 *teleport start* 和 *teleport end* 之间，不再是 *to* 所指的节点里了  

# Teleport 实现  

## isTeleport  
用来检测是否是一个 `Teleport` 组件  

```typescript
export const isTeleport = (type: any): boolean => type.__isTeleport
```

## isTeleportDisabled  
用来检测 `Teleport` 是否被禁用了  

```typescript
export const isTeleportDisabled = (props: VNode['props']): boolean =>
    props && (props.disabled || props.disabled === '')
```

只要 `disabled` 能转换为 `true` 或者为空字符串，都被认为是禁用的  

## resolveTarget  
这个函数用来解析 [to](#to) 属性的值  

```typescript
const resolveTarget = <T = RendererElement>(
    props: TeleportProps | null,                // teleport 的 props 集合
    select: RendererOptions['querySelector']    // 各个平台提供的查询节点函数，DOM 下就是 document.querySelector
): T | null => {
    // 获取 to 属性值
    const targetSelector = props && props.to
		
    if (isString(targetSelector)) {
      	// to 为字符串
        if (!select) {
            __DEV__ &&
                warn(
                `Current renderer does not support string target for Teleports. ` +
                    `(missing querySelector renderer option)`
                )
            return null
        } else {
          	// 调用 select 获取节点对象
            const target = select(targetSelector)
            if (!target) {
                __DEV__ &&
                warn(
                    `Failed to locate Teleport target with selector "${targetSelector}". ` +
                    `Note the target element must exist before the component is mounted - ` +
                    `i.e. the target cannot be rendered by the component itself, and ` +
                    `ideally should be outside of the entire Vue component tree.`
                )
            }
            return target as any
        }
    } else {
      	// to 不是字符串，直接返回
        if (__DEV__ && !targetSelector && !isTeleportDisabled(props)) {
            warn(`Invalid Teleport target: ${targetSelector}`)
        }
        return targetSelector as any
    }
}
```

## TeleportImpl  
这是 `Teleport` 组件的具体实现，就是一个普通的对象，通过 `__isTeleport` 来标识这是一个 `Teleport` 组件，总共提供了四种操作函数  

```typescript
export const TeleportImpl = {
    __isTeleport: true,
    process () {},
    remove () {},
    move: moveTeleport,
    hydrate: hydrateTeleport,
}
```

### process  
这是操作 `Teleport` 组件的入口函数，在 [patch]() 中会被调用  

```typescript
process(
    n1: TeleportVNode | null,       // 旧 vnode
    n2: TeleportVNode,              // 新 vnode
    container: RendererElement,     // teleport 组件所在的容器
    anchor: RendererNode | null,    // 将 teleport 渲染在该节点之前
    parentComponent: ComponentInternalInstance | null,  // 父组件
    parentSuspense: SuspenseBoundary | null,            // 父 Suspense 作用域
    isSVG: boolean,
    optimized: boolean,
    internals: RendererInternals
) {
    const {
        mc: mountChildren,
        pc: patchChildren,
        pbc: patchBlockChildren,
        o: { insert, querySelector, createText, createComment }
    } = internals

    // 检查新 vnode 是否禁用
    const disabled = isTeleportDisabled(n2.props)
    const { shapeFlag, children } = n2

    if (n1 == null) {
        // 挂载
        // 创建 Teleport 的两个范围节点，并插入到 container 中
        const placeholder = (n2.el = __DEV__
            ? createComment('teleport start')
            : createText(''))
        const mainAnchor = (n2.anchor = __DEV__
            ? createComment('teleport end')
            : createText(''))
        insert(placeholder, container, anchor)
        insert(mainAnchor, container, anchor)
        // 解析 to 属性，获取目标节点 target
        const target = (n2.target = resolveTarget(n2.props, querySelector))
        // 创建 targetAnchor 节点
        const targetAnchor = (n2.targetAnchor = createText(''))
        // 目标节点存在，则将 targetAnchor 插入到 target 中
        if (target) {
            insert(targetAnchor, target)
            // #2652 we could be teleporting from a non-SVG tree into an SVG tree
            isSVG = isSVG || isTargetSVG(target)
        }
        // 定义挂载 children 的函数，将所有的 children 挂载在 container 里的 anchor 之前
        const mount = (container: RendererElement, anchor: RendererNode) => {
            if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
                mountChildren(
                    children as VNodeArrayChildren,
                    container,
                    anchor,
                    parentComponent,
                    parentSuspense,
                    isSVG,
                    optimized
                )
            }
        }
        
        if (disabled) {
            // 如果 Teleport 禁用，则将 children 挂载到当前所在的容器中，且在 teleport end 之前
            mount(container, mainAnchor)
        } else if (target) {
            // 如果 Teleport 未禁用，则将 children 挂载在 target 中，且在 targetAnchor 之前
            mount(target, targetAnchor)
        }
    } else {
        // 更新
        // 复用 el，即 teleport start
        n2.el = n1.el
        // 复用 anchor，即 teleport end
        const mainAnchor = (n2.anchor = n1.anchor)!
        // 复用 target
        const target = (n2.target = n1.target)!
        // 复用 targetAnchor
        const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
        // 检测老节点是否禁用
        const wasDisabled = isTeleportDisabled(n1.props)
        // 获取老节点所在的 container 和 anchor
        // 如果老节点禁用，那么它就在 teleport start 和 teleport end 之间
        //   所以容器就是 container，anchor 就是 mainAnchor(teleport end)
        // 如果老节点未禁用，那么它就在 target 里，所以容器就是 target，anchor 就是 targetAnchor
        const currentContainer = wasDisabled ? container : target
        const currentAnchor = wasDisabled ? mainAnchor : targetAnchor

        isSVG = isSVG || isTargetSVG(target)

        if (n2.dynamicChildren) {
            // patch 所有的动态 children
            patchBlockChildren(
                n1.dynamicChildren!,
                n2.dynamicChildren,
                currentContainer,
                parentComponent,
                parentSuspense,
                isSVG
            )
            // TODO: even in block tree mode we need to make sure all root-level nodes
            // in the teleport inherit previous DOM references so that they can
            // be moved in future patches.
            traverseStaticChildren(n1, n2, true)
        } else if (!optimized) {
            // patch 所有的 children
            patchChildren(
                n1,
                n2,
                currentContainer,
                currentAnchor,
                parentComponent,
                parentSuspense,
                isSVG
            )
        }

        if (disabled) {
            if (!wasDisabled) {
                // 老节点未禁用，新节点被禁用，此时需要将所有的 children 从 target 中移动到 container 中
                moveTeleport(
                    n2,
                    container,
                    mainAnchor,
                    internals,
                    TeleportMoveTypes.TOGGLE    // 这里移动类型是 TOGGLE 
                )
            }
        } else {
            // 新节点未禁用，此时，children 必须要在 target 里，如果不在就要移动
            // 检测 target 是否发送变化
            if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
                // 重新解析新的 target
                const nextTarget = (n2.target = resolveTarget(
                    n2.props,
                    querySelector
                ))
                // 将 children 从旧 target 移动到新 target 中
                if (nextTarget) {
                    moveTeleport(
                        n2,
                        nextTarget,
                        null,
                        internals,
                        TeleportMoveTypes.TARGET_CHANGE // 这里移动类型是 TARGET_CHANGE
                    )
                }
            } else if (wasDisabled) {
                // 老节点禁用，新节点未禁用，此时需要将所有的 children 从 container 中移动到 target 中
                moveTeleport(
                    n2,
                    target,
                    targetAnchor,
                    internals,
                    TeleportMoveTypes.TOGGLE    // 这里移动类型是 TOGGLE
                )
            }
        }
    }
}
```  

### moveTeleport    
`Teleport` 组件发生移动时，针对 `disabled` 的情况，可能有以下  
* 禁用: 此时，`children` 全部在 `container` 中，所以需要移动的有 **teleport start**、**teleport end** 以及所有 **children**  
* 非禁用: 此时，`children` 全部在 `target` 中，所以需要移动的有 **teleport start** 和 **teleport end** 

移动 `Teleport` 的类型有三种，均发生在更新阶段，如下  

```typescript
export const enum TeleportMoveTypes {
    TARGET_CHANGE,  // target 发生变化时
    TOGGLE,         // 禁用/启用状态改变时
    REORDER,        // Teleport 顺序发生变化时
}
```  

```typescript
function moveTeleport(
    vnode: VNode,                                           // teleport 的 vnode
    container: RendererElement,                             // 需要移动到的容器
    parentAnchor: RendererNode | null,                      // 需要移动到该节点之前的节点
    { o: { insert }, m: move }: RendererInternals,
    moveType: TeleportMoveTypes = TeleportMoveTypes.REORDER // 移动类型
) {
    // 由于 target 发生了变化，所以需要先将 targetAnchor 插入到新的 target 中
    if (moveType === TeleportMoveTypes.TARGET_CHANGE) {
        insert(vnode.targetAnchor!, container, parentAnchor)
    }
    
    const { el, anchor, shapeFlag, children, props } = vnode
    // 是否处于 teleport 顺序改变下
    const isReorder = moveType === TeleportMoveTypes.REORDER

    // 移动整个 teleport 节点：首先移动 el，即 teleport start
    if (isReorder) {
        insert(el!, container, parentAnchor)
    }

    // 什么时候才会移动 children
    // 1. 禁用/启用状态发生变化时
    // 2. target 发生变化时
    // 3. teleport 需要移动，且处于禁用状态下(此时 children 都在 container 中)
    if (!isReorder || isTeleportDisabled(props)) {
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            for (let i = 0; i < (children as VNode[]).length; i++) {
                move(
                    (children as VNode[])[i],
                    container,
                    parentAnchor,
                    MoveType.REORDER
                )
            }
        }
    }
    
    // 移动整个 teleport 节点：最后移动 anchor，即 teleport end
    if (isReorder) {
        insert(anchor!, container, parentAnchor)
    }
}
```  

### remove  
当 `Teleport` 卸载时，会在 [unmount]() 里卸载所有的 `children`，但是并不会删除 `children`，所以会在 [unmount]() 里调用这个函数，来删除 `Teleport` 中的节点  
在这个函数里只会删除 `anchor`(即`teleport end`) 以及所有的 `children` 节点，至于 `el`(即`teleport start`) 会在 [unmount]() 里删除  

```typescript
remove(
    vnode: VNode,
    { r: remove, o: { remove: hostRemove } }: RendererInternals
) {
    const { shapeFlag, children, anchor } = vnode
    // 删除 anchor，即 teleport end
    // 至于 el(teleport start) 会在 unmount 里删除
    hostRemove(anchor!)
    // 删除所有的 children 节点
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      for (let i = 0; i < (children as VNode[]).length; i++) {
        remove((children as VNode[])[i])
      }
    }
}
```  

# 补充  
## targetAnchor  
在 [process](#process) 中，创建好 `targetAnchor` 后，每次都是将其 `append` 到 `container` 中  
这也就导致了，只要挂载 `Teleport` 组件，在 `target` 里，所有的 `children` 都会 `append` 到 `target` 的最后面

看下面这个示例，其中 `<!--text node-->` 表示文本节点而非注释节点
```typescript
const target = nodeOps.createElement('div')
const root = nodeOps.createElement('div')

render(h('div', [null, h(Teleport, { to: target }, 'three')]), root)

// root.innerHTML
// <div><!----><!--teleport start--><!--teleport end--></div>
// target.innerHTML
// three<!--text node-->

render(
    h('div', [
        h(Teleport, { to: target }, [h('div', 'one'), h('div', 'two')]),
        h(Teleport, { to: target }, 'three')
    ]),
    root
)

// root.innerHTML
// <div><!--teleport start--><!--teleport end--><!--teleport start--><!--teleport end--></div>
// three<!--text node--><div>one</div><div>two</div><!--text node-->
```  
