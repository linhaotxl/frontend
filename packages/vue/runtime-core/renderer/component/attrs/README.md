> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [其他模块用到的函数](#其他模块用到的函数)
- [renderComponentRoot](#rendercomponentroot)
    - [getFunctionalFallthrough](#getfunctionalfallthrough)
    - [filterModelListeners](#filtermodellisteners)
- [示例](#示例)
    - [过滤 v-model 的事件函数](#过滤-v-model-的事件函数)

<!-- /TOC -->

# 其他模块用到的函数  
1. [normalizeVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md#normalizeVNode)  
2. [isModelListener](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#isModelListener)
2. [isOn](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#isOn)
2. [cloneVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#cloneVNode)

# renderComponentRoot  
这个函数主要做两件事  
1. 调用组件实例的 `render` 方法，生成子 `vnode`  
2. 处理组件的属性透传  
    属性的透传发生在渲染组件子节点后，将组件的 `attrs` 与子节点的 `props` 合并，成为一个新的 `vnode`，之后渲染的就是这个新的 `vnode` 了  

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
        
        // 检测组件的类型
        if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
            // 状态组件
            // 组件的代理对象，如果是通过 template 生成的 render 方法，则使用 withProxy；否则就不会存在，使用 proxy 作为代理对象
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
            // 如果没有定义，此时 props 和 attrs 指向同一个对象，通过 getFunctionalFallthrough 获取透传的属性
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
                    // 过滤 v-model 的事件函数，可以参考下面的示例
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

        // 继承指令
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

<!-- TODO: -->
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
过滤掉 `v-model` 的事件函数  

```typescript
/**
 * @param { Data }              attrs 过滤之前的 attrs  
 * @param { NormalizedProps }   props props 配置对象  
 */
const filterModelListeners = (attrs: Data, props: NormalizedProps): Data => {
    const res: Data = {}
    // v-model:xxx 会被解析为两个 props，一个为具体的值，即 xxx，一个为更新这个值的事件函数，即 onUpdatedXxx
    // 遍历 attrs，以下两种情况会将 attrs 中的值记录在 res 中
    // 1. 不是 v-model 的事件函数
    // 2. 是以 onUpdate: 开头的事件函数，此时会有两种情况
    //      a. 是 v-model 的事件函数
    //      b. 是自定义以 onUpdate: 开头的事件函数
    // 所以通过 key.slice(9) 获取更新的名称，检测是否存在于 props 配置对象中，如果存在则说明这是一个标注的 v-model；如果不存在字就是自定义事件
    for (const key in attrs) {
        if (
            !isModelListener(key) ||
            !(key.slice(9) in props)
        ) {
            res[key] = attrs[key]
        }
    }
    return res
}
```  

# 示例  

## 过滤 v-model 的事件函数  

有下面几个组件  

```typescript
let textFoo = ''
let textBar = ''

const App = defineComponent({
    setup() {
        const appOnUpdatedModelValue = ( val: string ) => {
          textFoo = val
        }
        return () =>
            h(Child, {
                modelValue: textFoo,
                'onUpdate:modelValue': appOnUpdatedModelValue
            })
    }
});

const Child = defineComponent({
    props: ['modelValue'],
    setup(_props, { emit }) {
        const childOnUpdatedModelValue = ( val: string ) => {
            textBar = val
            emit('update:modelValue', 'from Child')
        }
        return () =>
            h(GrandChild, {
                modelValue: textBar,
                'onUpdate:modelValue': childOnUpdatedModelValue
            })
    }
});

const GrandChild = defineComponent({
    props: ['modelValue'],
    setup(_props, { emit }) {
        return () =>
            h('button', {
                onClick() {
                    click()
                    emit('update:modelValue', 'from GrandChild')
                }
            })
    }
})

// 渲染
render( h( App ), document.querySelector( '#root' ) );
```  

1. 在 `App` 中渲染 `Child` 时，传递了两个 `props`，所以 `Child` 对应的 `vnode.props` 含有两个值，由于 `Child` 只需要接受 `modelValue`，所以 `Child` 组件实例的 `props` 就是  

    ```typescript
    { modelValue: textFoo }
    ```

    而 attrs 就是  

    ```typescript
    { 'onUpdate:modelValue': appOnUpdatedModelValue } 
    ```

2. 在 `Child` 中渲染 `GrandChild` 时，传递了两个 `props`，所以 `GrandChild` 对应的 `vnode.props` 含有两个值，此时需要将 `Child` 的 `attrs` 和 `GrandChild` 的 `vnode` 合并，导致 `GrandChild` 的 vnode.props 就是  

    ```typescript
    { modelValue: textBar, 'onUpdate:modelValue': [ childOnUpdatedModelValue, appOnUpdatedModelValue ] }
    ```  

    由于 `GrandChild` 只需要接受 `modelValue`，所以 `GrandChild` 组件实例的 `props` 就是  

    ```typescript
    { modelValue: textBar }，attrs 就是 { 'onUpdate:modelValue': [ childOnUpdatedModelValue, appOnUpdatedModelValue ] }
    ```

3. 此时在 `button` 按钮上触发 `click` 事件，就会触发 `update:modelValue` 事件，由于存在两个，所以会依次触发  
    * 先触发 `childOnUpdatedModelValue` 函数，从而修改 `textBar` 为 `from GrandChild`，接着在其内部触发 `appOnUpdatedModelValue`，从而修改 `textFoo` 为 `from Child`  
    * 再触发 `appOnUpdatedModelValue`，从而修改 `textFoo` 为 `from GrandChild`  

可以看到，在 `GrandChild.props` 存在两个 `update:modelValue`，导致会触发两次，所以需要通过 [filterModelListeners](#filterModelListeners) 过滤掉 `v-model` 的事件函数 