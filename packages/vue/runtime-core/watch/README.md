> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [watch 和 watchEffect](#watch-和-watcheffect)
- [watchEffect](#watcheffect)
- [watch](#watch)
- [doWatch](#dowatch)

<!-- /TOC -->

# watch 和 watchEffect  
这两个函数都可以用来监听某个值，当值发生变化的时候，就会调用副作用(回调)  
  
1. `watch` 需要指定监听的值，当其发生变化时触发 `cb`，而 `watchEffect` 是自动查找监听的值，当值发生变化时触发 `cb`  
    * 由于 `watch` 需要指定值，所以指定的值会存在多种类型   
    * `watchEffect` 是如何自动查找的，就是先执行一遍 `cb`，看看 `cb` 里都用到了哪些值，记录并追踪  

2. `watch` 和 `watchEffect` 都可以指定副作用的执行时机，可以是同步，渲染前、渲染后(异步)  
    * 这里的时机可以参考 [异步队列](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/scheduler/README.md)，渲染前其实就是放入了 `pre` 队列，而渲染后就是放进了 `post` 队列  

# watchEffect  
`watchEffect` 接受两个参数  
1. 副作用  
2. 配置对象  

```typescript
export function watchEffect(
    effect: WatchEffect,
    options?: WatchOptionsBase
): WatchStopHandle {
    // 调用 doWatch，注意第二个参数为 null
    return doWatch(effect, null, options)
}
```  

# watch  
watch 一共有三个参数  
1. 监听的值，可以是以下类型  
    * ref 对象  
    * reactive 响应对象  
    * 数组(监听多个)  
    * 函数  
2. 副作用  
3. 配置对象  

```typescript
export function watch<T = any>(
    source: WatchSource<T> | WatchSource<T>[],
    cb: WatchCallback<T>,
    options?: WatchOptions
): WatchStopHandle {
    // 副作用不是函数会抛警告
    if (__DEV__ && !isFunction(cb)) {
        warn(
        `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
            `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
            `supports \`watch(source, cb, options?) signature.`
        )
    }
    // 调用 doWatch，并把所有参数传过去
    return doWatch(source, cb, options)
}
```  

# doWatch  
可以看到，[watchEffect](#watchEffect) 和 [watch](#watch) 都是通过 `doWatch` 实现的，而用来区分到底是哪一个函数调用，就是通过第二个参数  
* 通过 [watchEffect](#watchEffect) 调用，第二个参数是 `null`  
* 通过 [watch](#watch) 调用，第二个参数是 *副作用* 函数  

