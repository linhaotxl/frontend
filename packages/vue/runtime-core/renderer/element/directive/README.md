> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [指令的形成](#指令的形成)
- [指令的内容](#指令的内容)
- [withDirectives](#withdirectives)
- [invokeDirectiveHook](#invokedirectivehook)

<!-- /TOC -->

# 指令的形成  
要形成带有指令的节点有两种方式  
1. 通过 `template` 编译  

    ```html
    <div v-test:b="a">Hello World!</div>
    ```  

    会被编译为  
    ```typescript
    _withDirectives((_openBlock(), _createBlock("div", null, "Hello World!", 512 /* NEED_PATCH */)), [
        [_directive_test, _ctx.a, "b"]
    ])
    ```  
    通过 [withDirectives](#withDirectives) 来生成  
    
2. 使用 [withDirectives](#withDirectives) 手动创建  

**通过 [renderComponentRoot](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/attrs/README.md#rendercomponentroot) 知道，组件上的指令最终会被元素节点继承到，所以指令只会作用在元素节点上**  

# 指令的内容
一般来说，指令就是一个对象，包含各个钩子函数，会在不同阶段执行  

```typescript
export interface ObjectDirective<T = any, V = any> {
    created?: DirectiveHook<T, null, V>                 // 创建
    beforeMount?: DirectiveHook<T, null, V>             // 挂载前
    mounted?: DirectiveHook<T, null, V>                 // 挂载后
    beforeUpdate?: DirectiveHook<T, VNode<any, T>, V>   // 更新前
    updated?: DirectiveHook<T, VNode<any, T>, V>        // 更新后
    beforeUnmount?: DirectiveHook<T, null, V>           // 卸载前
    unmounted?: DirectiveHook<T, null, V>               // 卸载后
    getSSRProps?: SSRDirectiveHook
}
```  

也有存在指令为函数的情况  

```typescript
export type FunctionDirective<T = any, V = any> = DirectiveHook<T, any, V>
```  

此时会将这个函数作为指令的 `mounted` 和 `updated` 的钩子  

每个钩子函数会接受四个参数，如下  

```typescript
export type DirectiveHook<T = any, Prev = VNode<any, T> | null, V = any> = (
    el: T,                          // 绑定的真实节点
    binding: DirectiveBinding<V>,   // 绑定对象
    vnode: VNode<any, T>,           // 新 vnode
    prevVNode: Prev                 // 老 vnode
) => void
```  

其中绑定对象会包含以下信息  

```typescript
export interface DirectiveBinding<V = any> {
    instance: ComponentPublicInstance | null    // 指令所在的组件实例
    value: V                                    // 指令的值(新)
    oldValue: V | null                          // 指令的值(旧)
    arg?: string                                // 指令参数
    modifiers: DirectiveModifiers               // 
    dir: ObjectDirective<any, V>                // 指令钩子对象
}
```  

# withDirectives  
这个函数用来创建一个带有指令的 `vnode`，带有两个参数  
1. 第一个参数为 `vnode`  
2. 第二个参数为指令列表，每个元素都是一个指令数组，分别包含 *钩子、值、参数*    

```typescript
export function withDirectives<T extends VNode>(
    vnode: T,
    directives: DirectiveArguments
): T {
    // 获取当前渲染的组件实例，只在 render 前后被设置/恢复，如果不存在则会抛出警告
    const internalInstance = currentRenderingInstance
    if (internalInstance === null) {
        __DEV__ && warn(`withDirectives can only be used inside render functions.`)
        return vnode
    }
    
    // 获取组件代理对象
    const instance = internalInstance.proxy
    // 获取 vnode 的指令集合
    const bindings: DirectiveBinding[] = vnode.dirs || (vnode.dirs = [])
    // 遍历指令列表
    for (let i = 0; i < directives.length; i++) {
        // 从指令对象里取出指令钩子、值、参数
        let [dir, value, arg, modifiers = EMPTY_OBJ] = directives[i]
        // 如果指令为函数，则解析为对象，并将函数作为挂载和更新的钩子
        if (isFunction(dir)) {
            dir = {
                mounted: dir,
                updated: dir
            } as ObjectDirective
        }
        // 存储绑定对象
        bindings.push({
            dir,
            instance,
            value,
            oldValue: void 0,
            arg,
            modifiers
        })
    }
    // 返回带有 dirs 的 vnode
    return vnode
}
```  

**注意，vnode.dirs 里存储的是绑定对象，而不是指令对象，绑定对象里会存储指令相关的内容**  

# invokeDirectiveHook  
这个函数用来执行某个时期指令的钩子  

```typescript
/**
 * @param { VNode } vnode 新 vnode
 * @param { VNode } prevNode 老 vnode
 * @param { ComponentInternalInstance } instance 组件实例
 * @param { keyof ObjectDirective } name 触发钩子的名称
 */
export function invokeDirectiveHook(
    vnode: VNode,
    prevVNode: VNode | null,
    instance: ComponentInternalInstance | null,
    name: keyof ObjectDirective
) {
    // 获取 新老 指令绑定列表
    const bindings = vnode.dirs!
    const oldBindings = prevVNode && prevVNode.dirs!
    // 遍历绑定列表
    for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i]
        // 如果存在旧的绑定对象，则将其旧值记录在新的绑定对象里
        if (oldBindings) {
            binding.oldValue = oldBindings[i].value
        }
        // 获取钩子函数，如果存在则调用，并传入四个函数
        const hook = binding.dir[name] as DirectiveHook | undefined
        if (hook) {
            callWithAsyncErrorHandling(hook, instance, ErrorCodes.DIRECTIVE_HOOK, [
                vnode.el,   // 真实节点
                binding,    // 绑定对象
                vnode,      // 新 vnode
                prevVNode   // 老 vnode
            ])
        }
    }
}
```