> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [Suspense 基本使用](#suspense-基本使用)

<!-- /TOC -->

# Suspense 基本使用  
`Suspense` 组件主要用于异步处理，例如当向服务端发送请求的过程中，需要展示 `loading`，就可以用 `Suspense` 组件  
`Suspense` 组件接受两个插槽  
 * `default` 插槽: 可以是异步组件，或者存在 `async setup` 函数，异步过程结束后会展示  
 * `fallback` 插槽: 异步过程结束前会展示  

```typescript
const Comp = defineComponent(() => new Promise(( resolve ) => {
    setTimeout(() => {
        resolve(() => h('div', 'complete'));
    }, 1000);
}));

const App = defineComponent(() => {
    return () => h(
        Suspense,
        null,
        {
            default: h(Comp),
            fallback: h('div', 'loading')
        }
    )
});

const root = nodeOps.createElement('div')
render(h(App), root);

expect(root.innerHTML).toBe(`<div>loading</div>`)

await timeout(1000);
expect(root.innerHTML).toBe(`<div>complete</div>`)
```  

在 [生成 `Suspense` 的 `vnode` ](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/vnode/README.md#createvnode) 时，会对 `default` 和 `fallback` 两个插槽进行处理，然后挂载在 `Suspense` 上  

```typescript
if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
    const { content, fallback } = normalizeSuspenseChildren(vnode)
    vnode.ssContent = content
    vnode.ssFallback = fallback
}
```  
