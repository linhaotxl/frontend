**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [注意](#注意)
- [ref 使用](#ref-使用)
- [vnode 中的 ref](#vnode-中的-ref)
- [setRef](#setref)
- [示例](#示例)
    - [更新 ref 过程](#更新-ref-过程)
    - [卸载 ref](#卸载-ref)
    - [设置 ref 为异步任务](#设置-ref-为异步任务)

<!-- /TOC -->

# 注意  
```html
<div ref="refKey"></div>
```  
为了以下说明方便，将 `ref` 的属性值( 即 `refKey` )称为 “**属性值**”，而将实际绑定到 `ref` 的值(也就是上面的 DOM 对象)，称为 “**实际值**”  

# ref 使用  
使用 `ref` 可以有如下几种方式  
1. 字符串形式  

    ```typescript
    const Comp = {
        render () {
            return h( 'div', { ref: 'refKey' } )
        }
    };
    ```  

    ```typescript
    const Comp = {
        setup () {
            const refKey = ref( null ); 
            return { refKey };
        },
        render () {
            return h( 'div', { ref: 'refKey' } )
        }
    };
    ```  

    注意：如果 `ref` 的 “属性值” 是字符串，并且这个字符串存在于 `setupState` 中，那么会同时更新 `setupState` 中的值  

2. `Ref` 对象形式  
    ```typescript
    const Comp = {
        setup () {
            const refKey = ref( null ); 
            return () => h( 'div', { ref: refKey } );
        }
    };
    ```  

3. 函数形式  

    `ref` “属性值” 可以接受一个函数作为参数，它有两个参数  
    * 当前 `ref` 的 “实际值”  
    * 当前组件所有 `ref` 的集合  

    ```typescript
    const refFn: VNodeRef = ( value, refs ) => {}
    const Comp = {
        render () {
            return h( 'div', { ref: refFn } );
        }
    };
    ```

# vnode 中的 ref  
在创建 `vnode` 的过程 [createVNode](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md#createVNode) 中，是通过 [normalizeRef](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md#normalizeRef) 来处理 `ref` 的   

```typescript
const normalizeRef = ({ ref }: VNodeProps): VNodeNormalizedRefAtom | null => {
    return (ref != null
        ? isArray(ref)
            ? ref
            : { i: currentRenderingInstance, r: ref }
        : null) as any
}
```  

可以看到，`vnode.ref` 的值有三种情况  
1. 没有传递 `ref`，则为 `null`  2
2. `ref` 为对象，包含当前渲染的组件实例，以及 `ref` 属性值  
3. `ref` 为数组，里面每个元素都是第二种情况的对象  

# setRef  
这个方法用来设置 `ref` 的 “实际值”，只会被调用在两个地方  
1. 挂载阶段 [patch]()，此时已经创建了真实 DOM 节点，并挂载在父节点中  
2. 卸载阶段 [unmount]()  

```typescript
/**
 * 
 * @param rawRef 新的 ref，包含渲染组件实例 i 以及 ref 的属性值 r
 * @param oldRawRef 旧的 ref，同上
 * @param parentComponent 父组件
 * @param parentSuspense 
 * @param vnode 新的 vnode 节点
 */
export const setRef = (
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentComponent: ComponentInternalInstance,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode | null
) => {
    if (isArray(rawRef)) {
        rawRef.forEach((r, i) => setRef(
            r,
            oldRawRef && (isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
            parentComponent,
            parentSuspense,
            vnode )
        )
        return
    }

    // ref 的实际值变量
    let value: ComponentPublicInstance | RendererNode | null

    // 检测新 vnode 是否存在，不存在说明是卸载
    if (!vnode) {
        // 卸载，将 ref 实际值设置为 null
        value = null
    } else {
        // 挂载/更新，根据组件是否是状态组件，来决定实际值
        if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
            // 状态组件，就是 ctx 的代理对象
            value = vnode.component!.proxy
        } else {
            // 非状态组件，就是真实节点
            value = vnode.el
        }
    }

    // 获取新的 ref 属性所在组件的实例，以及 ref 的 属性值
    const { i: owner, r: ref } = rawRef
    // 获取旧的 ref 的 属性值
    const oldRef = oldRawRef && (oldRawRef as VNodeNormalizedRefAtom).r
    // 获取组件上的 refs 对象
    const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
    // 获取组件的 setup 状态
    const setupState = owner.setupState

    // 卸载老的 ref，新老 ref 不一样，就会卸载老的 ref，同步将实际值设置为 null
    if (oldRef != null && oldRef !== ref) {
        if (isString(oldRef)) {
            refs[oldRef] = null
            if (hasOwn(setupState, oldRef)) {
                setupState[oldRef] = null
            }
        } else if (isRef(oldRef)) {
            oldRef.value = null
        }
    }

    // 处理新的 ref
    if (isString(ref)) {
        const doSet = () => {
            refs[ref] = value
            if (hasOwn(setupState, ref)) {
                setupState[ref] = value
            }
        }
        // #1789: for non-null values, set them after render
        // null values means this is unmount and it should not overwrite another
        // ref with the same key
        // 检测是否是卸载
        if (value) {
            // 挂载/更新，将更新 ref 的操作放在异步中去做，异步设置 ref 实际值
            ;(doSet as SchedulerCb).id = -1
            queuePostRenderEffect(doSet, parentSuspense)
        } else {
            // 卸载，同步更新 ref 实际值为 null
            doSet()
        }
    } else if (isRef(ref)) {
        // 和上面 string 操作一样
        const doSet = () => {
            ref.value = value
        }
        if (value) {
            ;(doSet as SchedulerCb).id = -1
            queuePostRenderEffect(doSet, parentSuspense)
        } else {
            doSet()
        }
    } else if (isFunction(ref)) {
        callWithErrorHandling(ref, parentComponent, ErrorCodes.FUNCTION_REF, [
            value,
            refs
        ])
    } else if (__DEV__) {
        warn('Invalid template ref type:', value, `(${typeof value})`)
    }
}
```  

# 示例  

## 更新 ref 过程  

```typescript
const fooEl = ref(null)
const barEl = ref(null)
const refKey = ref('foo')

const Comp = {
    setup() {
        return {
            foo: fooEl,
            bar: barEl
        }
    },
    render() {
        return h('div', { ref: refKey.value })
    }
}

render(h(Comp), root)

// 第一次 ref 的属性值为字符串 foo，所以 setup state 中的 foo 也是真实节点
console.log( fooEl.value === root.children[0] );    // true
console.log( barEl.value === null );                // true

refKey.value = 'bar'
await nextTick()

// 现在 ref 的属性值为字符串的 bar，此时进入 setRef 会先处理旧的 ref，即 foo
// 将组件实例中的 foo 设置为 null，并且更新 setup state 中的 foo 为 null
// 之后再设置 bar 的 ref
console.log( fooEl.value === null );                // true
console.log( barEl.value === root.children[0] );    // true
```  

## 卸载 ref   

```typescript
const el = ref(null)
const toggle = ref(true)

const Comp = {
    setup() {
        return {
            refKey: el
        }
    },
    render() {
        return toggle.value ? h('div', { ref: 'refKey' }) : null
    }
}

render(h(Comp), root)

console.log( el.value === root.children[0] );   // true

toggle.value = false

await nextTick()

// 这个时候会在卸载的时候调用 setRef，并且第 2、5 两个参数都是 null
// 所以在 setRef 内部，value 就是 null，表示最终的实际值，会同时更新组件内部的 refs 和 setup state 中的 refKey
console.log( el.value === null );   // true
```  

## 设置 ref 为异步任务  

```typescript
const root = document.querySelector( '#root' );
const Comp = {
    setup() {
        const el = ref()
        return { el }
    },
    render(this: any) {
        return h('div', { id: 'foo', ref: 'el' }, this.el && this.el.getAttribute( 'id' ))
    }
}

render(h(Comp), root)

// 到这里会执行一次组件的 render 方法，会收集 el 的依赖，当 el 发生变化时，会再次触发 render

// 将 div 挂载好后，执行 setRef，将 doSet 方法放进了异步队列中，并且开启了异步刷新，将 flushJobs 放进下一轮微任务中执行
// 在 render 最后会刷新一次异步任务队列，所以执行 doSet 还是处于同步环境下，但在 doSet 里会更新 setupState 中 el，导致 Comp.update 会放进异步队列中
// 所以现在还没有子节点
console.log( root.innerHTML === '<div id="foo"></div>' );       // true

await nextTick()

// 等到下一轮微任务开始行，会刷新异步队列，再次执行 Comp.render 渲染组件，使子节点为 foo
console.log( root.innerHTML === '<div id="foo">foo</div>' );    // true
```