> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [插槽的形式](#插槽的形式)
- [normalizeChildren](#normalizechildren)
- [initSlot](#initslot)
    - [normalizeObjectSlots](#normalizeobjectslots)
    - [isInternalKey](#isinternalkey)
    - [normalizeSlotValue](#normalizeslotvalue)
    - [normalizeSlot](#normalizeslot)
    - [normalizeVNodeSlots](#normalizevnodeslots)
- [renderSlot](#renderslot)
- [withCtx](#withctx)
- [createSlots](#createslots)
- [示例](#示例)
    - [编译过的插槽](#编译过的插槽)
    - [未编译过的插槽](#未编译过的插槽)
    - [手动调用 slot](#手动调用-slot)

<!-- /TOC -->

# 插槽的形式  
组件的子节点会通过插槽进行传递，插槽会被编译一个对象，里面的每个 `key` 都是插槽的名称，默认为 `default`，例如  

```html
<Comp>

    <template v-slot:header="headerProps">
        <div>this is header</div>
    </template>

    <template v-slot="contentProps">
        <div>this is content</div>
    </template>

    <template v-slot:footer>
        <div>this is footer</div>
    </template>

</Comp>
```  

会被编译为  

```typescript
createBlock(_component_Comp, null, {
    header: _withCtx(() => [
        _createVNode("div", null, "header")
    ]),
    footer: _withCtx(() => [
        _createVNode("div", null, "footer")
    ]),
    default: _withCtx(() => [
        _createVNode("div", null, "Content")
    ]),
    _: 1
})
```  

**Comp 的子节点由编译生成，所以它的格式是最正确的，被称为 “插槽对象”，里面的 `key` 称为 “插槽名称”，值称为 “插槽值”**  

每个 `v-slot` 都对应一个插槽名称和值，并且插槽值是一个函数，它的返回值就是这个插槽需要渲染的节点，注意，**插槽值必须处于上下文 `ctx` 中，这里使用了 [withCtx](#withCtx) 来实现**  

其中的 `_` 属性，它代表了插槽的类型   

以上是插槽最正确的格式，但是难免也会存在不符合规则的格式，例如直接写 `render` 函数，不经过编译，这时候就需要经过格式化，达到统一格式，方便后续处理，例如  

```typescript
const Comp = {
    render() {
        return h('div')
    }
}

render( Comp, null, {
    _inner: '_inner',
    foo: null,
    header: 'header',
    footer: ['f1', 'f2']
})
```  

**像这种没有被处理过的插槽对象的值，称为 “原始值”**  
  
首先来看创建 `vnode` 的时候是如何处理插槽对象的  

# normalizeChildren  
这个函数就是 [vnode 里的 normalizeChildren](#normalizeChildren)，专门用来格式化子节点，这里只看对插槽对象的处理  

```typescript
let type = 0

if (children == null) { /* ... */ }
else if (isArray(children)) { /* ... */ }
else if (typeof children === 'object') {
    if (shapeFlag & ShapeFlags.ELEMENT || shapeFlag & ShapeFlags.TELEPORT) {
        // ...
    } else {
        // 此时 children 为对象，且当前 vnode 是一个组件，所以被认为是插槽对象
        // 设置 vnode 的 shapFlag 为 SLOTS_CHILDREN，表示组件具有插槽子节点
        type = ShapeFlags.SLOTS_CHILDREN
        // 获取插槽类型
        const slotFlag = (children as RawSlots)._
        
        if (!slotFlag && !(InternalObjectKey in children!)) {
            // 插槽类型不存在，代表这是一个没有经过编译创建的 vnode（ 经过编译肯定是存在插槽类型的 ）
            // 上面说过，每个插槽值都要处于上下文中，而现在插槽对象又是不符合规范的，所以将当前渲染的组件记录在 ctx 中作为上下文，后面会用到
            ;(children as RawSlots)._ctx = currentRenderingInstance
        } else if (slotFlag === SlotFlags.FORWARDED && currentRenderingInstance) {
            // a child component receives forwarded slots from the parent.
            // its slot type is determined by its parent's slot type.
            if (
                currentRenderingInstance.vnode.patchFlag & PatchFlags.DYNAMIC_SLOTS
            ) {
                ;(children as RawSlots)._ = SlotFlags.DYNAMIC
                vnode.patchFlag |= PatchFlags.DYNAMIC_SLOTS
            } else {
                ;(children as RawSlots)._ = SlotFlags.STABLE
            }
        }
    }
}
else if (isFunction(children)) {
    // 如果子节点是函数，则被视为默认插槽对象
    children = { default: children, _ctx: currentRenderingInstance }
    type = ShapeFlags.SLOTS_CHILDREN
}
else { /* ... */ }

vnode.children = children as VNodeNormalizedChildren
vnode.shapeFlag |= type
```  

# initSlot  
初始化 `slot` 发生在第一次安装组件 [setupcomponent](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#setupcomponent) 的过程中，最终会把解析好的插槽对象挂载到组件实例的 `slots` 上  

```typescript
/**
 * 初始化 slot
 * @param instance 组件实例
 * @param children 子节点集合
 */
export const initSlots = (
    instance: ComponentInternalInstance,
    children: VNodeNormalizedChildren
) => {
    // 1
    if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
        // 当前组件具有插槽子节点
        // 获取插槽类型
        const type = (children as RawSlots)._
        if (type) {
            // 插槽类型存在，是由编译生成的，不需要再格式化，直接挂载到 slots 上
            instance.slots = children as InternalSlots
            // 使插槽类型属性 _ 不可枚举
            def(children as InternalSlots, '_', type)
        } else {
            // 插槽类型不存在，是自定义的，所以需要统一格式化
            normalizeObjectSlots(children as RawSlots, (instance.slots = {}))
        }
    }
    // 2
    else {
        instance.slots = {}
        if (children) {
            normalizeVNodeSlots(instance, children)
        }
    }
    
    def(instance.slots, InternalObjectKey, 1)
}
```  

一个组件的插槽对应两种形式  
1. 对象：这是默认形式，也是标准形式；此时会进入 1 的逻辑  
2. 数组：这种可能是自己写的，例如  

    ```typescript
    render(h(Comp, null, [
        h('span')
    ]), document.createElement('div'))
    ```  

    此时就会进入 2 的逻辑来处理  
    
**尽量还是使用对象插槽，因为对象插槽值是函数，只有在被使用的时候才会被调用；而数组在创建的时候就已经生成了；性能没有对象的好**  

## normalizeObjectSlots  
这个函数用来格式化插槽对象，将 “插槽的原始值” 格式化为标准值，并将结果挂载在组件的 `slots` 上

```typescript
/**
 * 格式化插槽对象
 * @param { RawSlots } rawSlots 原始插槽数据 
 * @param { InternalSlots } slots 组件实例上的 slots 
 */
const normalizeObjectSlots = (rawSlots: RawSlots, slots: InternalSlots) => {
    // 获取上下文，上面说过，在 normalizeChildren 的时候会为自定义插槽对象添加上下文 _ctx
    const ctx = rawSlots._ctx
    
    // 遍历原始插槽对象
    for (const key in rawSlots) {
        // 过滤内部属性
        if (isInternalKey(key)) continue
        // 获取插槽原始值
        const value = rawSlots[key]
        
        if (isFunction(value)) {
            // 如果原始值是函数，则将这个函数指定一个上下文 ctx，并将结果挂载在组件实例的 slots 上
            slots[key] = normalizeSlot(key, value, ctx)
        } else if (value != null) {
            // 如果原始值不是函数且是有效值，则先抛出警告，因为 插槽值 最佳使用就是函数，否则会影响性能
            // 接着将原始值转换为最终渲染的 vnode，并将返回 vnode 的函数挂载在 slots 上
            if (__DEV__) {
                warn(
                `Non-function value encountered for slot "${key}". ` +
                    `Prefer function slots for better performance.`
                )
            }
            const normalized = normalizeSlotValue(value)
            slots[key] = () => normalized
        }
    }
}
```    

## isInternalKey  
这个函数用来过滤内部属性，只有两种属性属于内部  
1. 以 `_` 开头  
2. `$stable` 属性  

```typescript
const isInternalKey = (key: string) => key[0] === '_' || key === '$stable'
```  

## normalizeSlotValue  
这个函数用来将原始值转换为渲染的 `vnode`，注意：**插槽的值必须会返回一个 `vnode` 的数组**  

```typescript
const normalizeSlotValue = (value: unknown): VNode[] => isArray(value)
    ? value.map(normalizeVNode)
    : [normalizeVNode(value as VNodeChild)]
```  

## normalizeSlot  
当 “原始值” 原本就是一个函数时，此时会调用这个方法，将 原始值 指定在 `ctx` 的上下文中  

```typescript
/**
 * @param { string } key 插槽名称
 * @param { Function } rawSlot 插槽原始值
 * @param { ComponentInternalInstance } ctx 上下文
 */
const normalizeSlot = (
    key: string,
    rawSlot: Function,
    ctx: ComponentInternalInstance | null | undefined
): Slot =>
    withCtx((props: any) => {
        if (__DEV__ && currentInstance) {
            warn(
                `Slot "${key}" invoked outside of the render function: ` +
                `this will not track dependencies used in the slot. ` +
                `Invoke the slot function inside the render function instead.`
            )
        }
        return normalizeSlotValue(rawSlot(props))
    }, ctx)
```  

## normalizeVNodeSlots  
这个函数用来处理插槽不为对象的情况，先通过 [normalizeSlotValue](#normalizeSlotValue) 转换为 `vnode` 数组，再挂载到 `slots` 的 `default` 插槽上  

```typescript
const normalizeVNodeSlots = (
    instance: ComponentInternalInstance,
    children: VNodeNormalizedChildren
) => {
    if (__DEV__ && !isKeepAlive(instance.vnode)) {
        warn(
            `Non-function value encountered for default slot. ` +
            `Prefer function slots for better performance.`
        )
    }
    const normalized = normalizeSlotValue(children)
    instance.slots.default = () => normalized
}
```  

# renderSlot  
这个函数用来渲染 `slot` 标签所对应的内容，一个完整的 `slot` 标签应该是这样的  

```vue
<!-- Parent -->
<Child>
    <template v-slot:header="headerProps">
        <span>this is header: age is {{ headerProps.age }} and sex is {{ headerProps.sex }}</span>
    </template>
</Child>

<!-- Child -->
<slot name="header" age="24" sex="male">
    <span>这是占位符</span>
</slot>
```  

会被编译为  

```typescript
// Parent
(_openBlock(), _createBlock(_component_Child, null, {
    header: _withCtx((headerProps) => [
        _createVNode("span", null, "this is header: age is " + _toDisplayString(headerProps.age) + " and sex is " + _toDisplayString(headerProps.sex), 1 /* TEXT */)
    ]),
    _: 1
}))

// Child
_renderSlot(_ctx.$slots, "header", { age: "24", sex: "male" }, () => [
    _createVNode("span", null, "这是占位符")
])
```  

下面依次说明 `renderSlot` 各个参数的意义  
1. 在 `Parent` 中渲染 `Child` 时，由于子节点为插槽对象，所以会解析并将结果挂载在 `Child` 组件实例的 `slots` 上  
   在 `Child` 组价中，可以通过 `$slots` 获取到 `Child` 实例上的 `slots` 对象  
   **第一个参数就是组件的插槽对象，即 `slots`**  

2. 插槽名称，在组件内需要渲染哪个插槽的内容，默认为 `default`，对应 `slot` 的 `name` 属性  
3. 在 `slot` 标签上，将除了 `name` 之外的所有属性全部放入第三个参数对象中，作为 `props` 传递，插槽值 作为一个函数，可以接收到这个 `props`  
4. 第四个参数是一个函数，返回值是当找不到对应的插槽名称时，就会渲染返回值的内容，对应 `slot` 标签内的子节点  

```typescript
export function renderSlot(
    slots: Slots,
    name: string,
    props: Data = {},
    fallback?: () => VNodeArrayChildren
): VNode {
    // 插槽值
    let slot = slots[name]

    // 标识插槽值里的内容是有 renderSlot 渲染的
    isRenderingCompiledSlot++

    // slot 外面是一个 Block 的 Fragment
    // slot 存在就调用并传入 props，不存在就调用 fallback
    const rendered = (
        openBlock(),
        createBlock(
            Fragment,
            { key: props.key },
            slot ? slot(props) : fallback ? fallback() : [],
            (slots as RawSlots)._ === SlotFlags.STABLE  // TODO:
                ? PatchFlags.STABLE_FRAGMENT
                : PatchFlags.BAIL
        )
    )
    
    // 恢复 renderSlot 渲染的标识
    isRenderingCompiledSlot--

    // 返回 Fragment
    return rendered
}
```  

**注意：**  
从 `return` 的内容可以知道，`<slot></slot>` 实际返回的是一个 `Fragment` 的 `block`，如果插槽值里存在动态节点，是会去追踪的  
但如果是手动调用插槽值函数来渲染，而不是通过 `renderSlot`，那么此时是不会追踪动态节点的，原因就在于 `isRenderingCompiledSlot`  

在 [withCtx](#withCtx) 中会判断 `isRenderingCompiledSlot` 标识，如果无效，则会开启一个新的且不会追踪的 `block`，从而导致 `currentBlock` 为 `null`，也就不会追踪了  

# withCtx  
这个函数用来将 插槽值 包裹一层，使其处于上下文 `ctx` 中

```typescript
export function withCtx(
    fn: Slot,
    ctx: ComponentInternalInstance | null = currentRenderingInstance
) {
    // 如果不存在上下文，直接返回原始函数
    if (!ctx) return fn
    
    // 封装的函数，在 renderSlot 里会被调用，参数 args 就是对应 <slot></slot> 所产生的 props
    const renderFnWithContext = (...args: any[]) => {
        // 检测当前渲染 slot 是否是在 renderSlot 里，如果在 renderSlot 里的话，isRenderingCompiledSlot 肯定是有效值而不是 0
        // 如果不在的话那么 isRenderingCompiledSlot 就是 0
        if (!isRenderingCompiledSlot) {
            // 当前渲染不处于 renderSlot 中，创建一个不会追踪的 block
            openBlock(true /* null block that disables tracking */)
        }

        // 获取当前渲染的组件实例
        const owner = currentRenderingInstance
        // 设置当前渲染组件实例为上下文 ctx
        setCurrentRenderingInstance(ctx)
        // 调用实际的 slot 函数，并传入参数 props，将渲染结果存储在 res 中
        const res = fn(...args)
        // 恢复当前渲染组件
        setCurrentRenderingInstance(owner)

        // 关闭上面创建的不会追踪的 block
        if (!isRenderingCompiledSlot) {
            closeBlock()
        }

        // 返回待渲染的列表
        return res
    }

    // 标识
    renderFnWithContext._c = true
    // 返回封装的函数
    return renderFnWithContext
}
```  

# createSlots  
这个函数用来创建一个动态的插槽对象，例如在 `v-if`、`v-for` 中，就会使用这个函数  

```html
<Comp>
  <template v-slot:header v-if="visible">header</template>
  <template v-slot:footer v-else>footer</template>
</Comp>
```  

会被解析为  

```typescript
(_openBlock(), _createBlock(_component_Comp, null, _createSlots({ _: 2 }, [
    (_ctx.visible)
      ? {
          name: "header",
          fn: _withCtx(() => [ _createTextVNode("header") ])
        }
      : {
          name: "footer",
          fn: _withCtx(() => [ _createTextVNode("footer") ])
        }
]), 1024 /* DYNAMIC_SLOTS */))
```  

```html
<Comp>
  <template v-slot:header v-for="i in data">header</template>
</Comp>
```  

会被解析为  

```typescript
(_openBlock(), _createBlock(_component_Comp, null, _createSlots({ _: 2 }, [
    _renderList(_ctx.data, i => {
        return {
            name: "header",
            fn: _withCtx(() => [ _createTextVNode("header") ])
        }
    })
]), 1024 /* DYNAMIC_SLOTS */))
```  

可以看到，`v-if` 和 `v-for` 在 `createSlots` 第二个参数不太一样  
`v-if` 是个普通的数组  
`v-for` 是个二维数组  

所以在 `createSlots` 会对这两种情况处理  

```typescript
/**
 * @param { Record<string, Slot> } slots 组件 slots 对象
 * @param { CompiledSlotDescriptor | CompiledSlotDescriptor[] } dynamicSlots 动态插槽对象
 */
export function createSlots(
  slots: Record<string, Slot>,
  dynamicSlots: (CompiledSlotDescriptor | CompiledSlotDescriptor[] | undefined)[]
): Record<string, Slot> {
    // 遍历动态插槽对象
    for (let i = 0; i < dynamicSlots.length; i++) {
        const slot = dynamicSlots[i]
        if (isArray(slot)) {
            // v-for 生成
            for (let j = 0; j < slot.length; j++) {
                slots[slot[j].name] = slot[j].fn
            }
        } else if (slot) {
            // v-if 生成
            slots[slot.name] = slot.fn
        }
    }
    return slots
}
```  

# 示例  

## 编译过的插槽

```html
<!-- Parent -->
<Child>
    <template v-slot:header="headerProps">
        <span>this is {{ headerProps.title }}</span>
    </template>
</Child>

<!-- Child -->
<slot name="header" title="Vue3.0"></slot>
```  

```typescript
// Parent
(_openBlock(), _createBlock(_component_Child, null, {
    header: _withCtx( headerProps => [
        _createVNode("span", null, "this is " + _toDisplayString(headerProps.title), 1 /* TEXT */)
    ]),
    _: 1
}))

// Child
_renderSlot(_ctx.$slots, "header", { title: "Vue3.0" })
```  

1. 在 [initSlot](#initSlot) 中，由于 `children` 是编译生成的，所以直接挂载在 `slots` 上  
2. 在 [renderSlot](#renderSlot) 中，获取 `header` 的插槽值 `renderFnWithContext`，调用它并将 `{ title: "Vue3.0" }` 作为参数传递，此时的上下文 `ctx` 就是 `Child` 组件实例   

## 未编译过的插槽  

```typescript
const Comp = {}
const headerSlot = props => `header is ${ props.title }`;
const slots = {
    header: headerSlot
}
render(h( Comp, null, slots ));

renderSlot( slots, 'header', { title: 'vue3.0' } );
```  

1. 创建 `Comp` 对应的 `vnode` 时，由于 `children` 是对象且不存在插槽类型，所以会将当前渲染的组件作为 `_ctx` 挂载在 `children` 上  
2. 通过 [normalizeObjectSlots](#normalizeObjectSlots) -> [normalizeSlot](#normalizeSlot) 格式化插槽值，将原始值封装在 `withCtx` 中   
3. 在 [renderSlot](#renderSlot) 中，会调用 `headerSlot`，参数就是 `{ title: 'vue3.0' }`，返回字符串 `'header is  vue3.0'`，接着被 [normalizeSlotValue](#normalizeSlotValue) 处理，生成一个返回 `vnode` 的数组  

## 手动调用 slot  

```typescript
const slot = withCtx(
    () => [createVNode('div', null, 'foo', PatchFlags.TEXT)],
    // mock instance
    {} as any
)

// 先开启一个 block，再手动调用 slot，此时 blockStack 为 [ [], null ]， currentBlock 为 null
// 在执行 slot 内部时，由于 patchFlag 存在，但是 currentBlock 却为 null，所以不会追踪
// 导致 Fragment.dynamicChildren 是空的
const manual = (openBlock(), createBlock(Fragment, null, slot()))
// manual.dynamicChildren!.length; // 0

// renderSlot 内部，先开启一个 block，接着调用 slot，此时由于 currentBlock 有效，所以会将动态节点 push 进去
const templateRendered = renderSlot({ default: slot }, 'default')
// templateRendered.dynamicChildren!.length; // 1
```
