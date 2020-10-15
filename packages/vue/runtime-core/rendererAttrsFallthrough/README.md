> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [源码中用到的工具函数](#源码中用到的工具函数)
- [属性透传](#属性透传)
    - [getFunctionalFallthrough](#getfunctionalfallthrough)
    - [filterModelListeners](#filtermodellisteners)

<!-- /TOC -->

# 源码中用到的工具函数  
1. [normalizeVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md#normalizeVNode)  
2. [isModelListener](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#isModelListener)
2. [isOn](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#isOn)
2. [cloneVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#cloneVNode)

# 属性透传  
属性的透传发生在渲染组件子节点后，拿到子节点后，将 `attrs` 与子节点的 `props` 合并，成为一个新的 `vnode`，之后渲染的就是这个新的 `vnode` 了  

```typescript
/**
 * 渲染组件的根节点
 * @param { ComponentInternalInstance } instance 组件实例
 */
export function renderComponentRoot(
    instance: ComponentInternalInstance
): VNode {
    
    const {
        type: Component,
        vnode,
        proxy,
        withProxy,
        props,
        propsOptions: [propsOptions],
        slots,
        attrs,
        emit,
        render,
        renderCache,
        data,
        setupState,
        ctx
    } = instance

    // 最终需要渲染的 vnode 变量
    let result

    // 渲染前，将当前渲染的组件记录在全局变量
    currentRenderingInstance = instance

    try {
        // 这个变量保存的是需要透传的属性集合
        let fallthroughAttrs
        
        if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
            // 状态组件
            // 组件的代理对象，如果是通过 template 生成的 render 方法，则使用 withProxy，否则就不会存在，使用 proxy 作为代理对象
            const proxyToUse = withProxy || proxy
            // 调用 render 方法，解析出子节点的 vnode 并格式化
            result = normalizeVNode(
                // render 方法中的 this 以及第一个参数都指向 proxyToUse
                render!.call(
                    proxyToUse,
                    proxyToUse!,
                    renderCache,
                    props,
                    setupState,
                    data,
                    ctx
                )
            )
            // 状态组件透传的属性就是 attrs 里面的所有属性
            fallthroughAttrs = attrs
        } else {
            // 函数组件
            const render = Component as FunctionalComponent
            // 调用 render 方法，解析出子节点的 vnode 并格式化
            result = normalizeVNode(
                render.length > 1
                    ? render(
                        props,
                        { attrs, slots, emit }
                    )
                    : render(props, null as any /* we know it doesn't need it */)
            )

            // 对于函数组件来说，他需要透传的属性取决于是否定义了需要接受的参数 props
            // 如果定义了，则透传的就是 attrs 里面的数据
            // 如果没有定义，此时 props 和 attrs 指向同一个对象，只会透传 class、style 以及事件处理函数三种数据
            fallthroughAttrs = Component.props
                ? attrs
                : getFunctionalFallthrough(attrs)
        }

        // 将 render 生成的 vnode 赋值给最终变量
        let root = result

        // 透传发生的条件，必须满足下面三个条件才可以透传属性
        // 1. Component.inheritAttrs 不是 false
        // 2. fallthroughAttrs 存在且含有属性
        // 3. 组件的子节点必须是元素或者组件
        if (Component.inheritAttrs !== false && fallthroughAttrs) {
            const keys = Object.keys(fallthroughAttrs)
            const { shapeFlag } = root
            if (keys.length) {
                if (
                    shapeFlag & ShapeFlags.ELEMENT ||
                    shapeFlag & ShapeFlags.COMPONENT
                ) {
                    // 检测是否存在 v-model 的事件
                    // 如果一个组件存在 v-model 属性，那么会被解析为两个属性，一个是具体的值，一个是更新事件
                    // <Input v-model:value="a" /> -> { value: ctx.a, 'onUpdate:value': () => {} }
                    // 那么在 Input 组件里是肯定会存在 value 的 props，所以这里需要检测 propsOptions，以及检测 propsOptions 中是否存在 v-model 的值，即 value
                    if (propsOptions && keys.some(isModelListener)) {
                        fallthroughAttrs = filterModelListeners(
                            fallthroughAttrs,
                            propsOptions
                        )
                    }
                    // 将原本的节点和透传的属性合并为一个新的 vnode
                    root = cloneVNode(root, fallthroughAttrs)
                }
            }
        }

        // inherit directives
        if (vnode.dirs) {
            root.dirs = vnode.dirs
        }
        
        // inherit transition data
        if (vnode.transition) {
            root.transition = vnode.transition
        }

        // 将上面几步生成的 vnode 赋值给最终变量
        result = root
    } catch (err) {
        // 处理错误
        handleError(err, instance, ErrorCodes.RENDER_FUNCTION)
        // 将最终节点设置为注释节点
        result = createVNode(Comment)
    }

    // 渲染后，重置全局变量
    currentRenderingInstance = null

    return result
}
```  

**注意，如果组件发生了透传，那么新 vnode 中，patchFlag 就会存在 PatchFlags.FULL_PROPS，这是在 [cloneVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#cloneVNode) 中发生的**  

## getFunctionalFallthrough  
获取没有声明 `props` 的函数组件，需要透传的属性集合，只会透传 `class`、`style` 以及事件函数  
  
```typescript
const getFunctionalFallthrough = (attrs: Data): Data | undefined => {
    let res: Data | undefined
    for (const key in attrs) {
        if (key === 'class' || key === 'style' || isOn(key)) {
            ;(res || (res = {}))[key] = attrs[key]
        }
    }
    return res
}
```  

## filterModelListeners  
过滤掉 `v-model` 的事件  

```typescript
const filterModelListeners = (attrs: Data, props: NormalizedProps): Data => {
    const res: Data = {}
    for (const key in attrs) {
        if (
            !isModelListener(key) ||    // 不是 v-model 属性
            !(key.slice(9) in props)    // 是 v-model，但是更新的值不存在于 props 中，可能是自定义的事件，例如 onUpdated:xxx
        ) {
            res[key] = attrs[key]
        }
    }
    return res
}
```