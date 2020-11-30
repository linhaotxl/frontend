> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [watch 和 watchEffect](#watch-和-watcheffect)
- [watchEffect](#watcheffect)
- [watch](#watch)
- [doWatch](#dowatch)
- [traverse](#traverse)
- [示例](#示例)
    - [监听组件 props](#监听组件-props)

<!-- /TOC -->

# watch 和 watchEffect  
这两个函数都可以用来监听某个值，当值发生变化的时候，就会调用副作用(回调)  
  
1. `watch` 需要指定监听的值，当其发生变化时触发*副作用*，而 `watchEffect` 是自动查找监听的值，当值发生变化时触发*副作用*  
    * 由于 `watch` 需要指定值，所以指定的值会存在多种类型，之后将指定的值记录下来     
    * `watchEffect` 是如何自动查找的，就是先执行一遍*副作用*，看看*副作用*里都用到了哪些值，记录并追踪  

2. `watch` 监听，可以从副作用中获取到最新的值和上一次的值，而 `watchEffect` 则获取不到  

3. `watch` 和 `watchEffect` 都可以指定副作用的执行时机，可以是同步，渲染前、渲染后(异步)  
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
大致逻辑就是：创建一个 `effect` 对象 `runner`，并尝试获取监听值，这样，当修改监听值的时候就可以触发副作用回调了  

可以看到，[watchEffect](#watchEffect) 和 [watch](#watch) 都是通过 `doWatch` 实现的，而用来区分到底是谁调用，就是通过第二个参数  
* 通过 [watchEffect](#watchEffect) 调用，第二个参数是 `null`  
* 通过 [watch](#watch) 调用，第二个参数是 *副作用* 函数  

这个函数以供会接受四个参数  

```typescript
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect,                        // 监听的值，或者副作用回调
  cb: WatchCallback | null,                                                 // watch 情况下的副作用回调
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ, // 配置对象
  instance = currentInstance                                                // 组件实例
): WatchStopHandle {
    /* ... */
}
```  

1. 定义 `effect` 对象  
    每一个 `watch` 或者 `watchEffect` 都会产生一个 `effect` 对象，来维护 *监听值* 和 *副作用* 之间的关系  

    ```typescript
    const runner = effect(getter, {
        lazy: true,
        onTrack,
        onTrigger,
        scheduler
    })

    recordInstanceBoundEffect(runner)
    ```  
    
    可以看到，这个 `effect` 是一带有 `lazy` 的，所以并不会立即执行 `getter`  

2. 创建 `effect` 原始函数 `getter`  
    如果是 `watch`，则这个函数做的就是处理了各种类型值的情况，并返回各种类型的值  
    如果是 `watchEffect`，则这个函数做的就是对副作用封装了一层  
    
    ```typescript
    let getter: () => any
    const isRefSource = isRef(source)
    if (isRefSource) {
        // 如果是 ref，那么 getter 直接返回 value
        getter = () => (source as Ref).value
    } else if (isReactive(source)) {
        // 如果是响应对象，那么 getter 直接返回响应对象
        getter = () => source
        deep = true
    } else if (isArray(source)) {
        // 如果是数组，那么 getter 返回对数组里每个元素的处理结果，组成的数组
        getter = () => source.map(s => {
            if (isRef(s)) {
                return s.value
            } else if (isReactive(s)) {
                return traverse(s)
            } else if (isFunction(s)) {
                return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
            } else {
                __DEV__ && warnInvalidSource(s)
            }
        })
    } else if (isFunction(source)) {
        if (cb) {
            // watch 情况：监听的值是个函数，那么 getter 直接返回 source 调用的结果
            getter = () => callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
        } else {
            // watchEffect 情况：那么 getter 会对副作用封装一层
            getter = () => {
                if (instance && instance.isUnmounted) {
                    return
                }
                if (cleanup) {
                    cleanup()
                }
                return callWithErrorHandling(
                    source,
                    instance,
                    ErrorCodes.WATCH_CALLBACK,
                    [onInvalidate]
                )
            }
        }
    } else {
        // 否则抛出警告，source 无效
        getter = NOOP
        __DEV__ && warnInvalidSource(source)
    }
    ```  

3. 创建 `effect` 调度器  
    当监听的值发生变化时，就会调用调度器，来执行具体的任务，这个具体的任务就是下面定义的 `job`，至于什么时机调用 `job`，取决于配置 `flush`  
    分别有同步、渲染前以及渲染后  
    
    ```typescript
    let scheduler: (job: () => any) => void
    if (flush === 'sync') {
        // 同步情况：调用 scheduler 就是调用 job
        scheduler = job
    } else if (flush === 'post') {
        // 异步情况：将 job 放如 post 队列
        scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
    } else {
        // 渲染前：将 job 放如 pre 队列
        scheduler = () => {
            if (!instance || instance.isMounted) {
                // 放入 pre 队列，等待异步刷新 flushJobs
                queuePreFlushCb(job)
            } else {
                // with 'pre' option, the first call must happen before
                // the component is mounted so it is called synchronously.
                job()
            }
        }
    }
    ``` 

4. 定义具体任务 job  
    如果是 `watch`，则这个函数做的就是：获取最新的监听值，检测是否需要调用副作用回调  
    如果是 `watchEffect`，直接调用副作用回调  
    `job` 任务是由调度器 `schedule` 调用的  

    ```typescript
    // watch 情况下保存旧值的变量
    let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE
    
    const job: SchedulerJob = () => {
        if (!runner.active) {
            return
        }
        if (cb) {
            // watch 情况下
            // 再次调用 runner 获取新值
            const newValue = runner()
            // 检测监听的值是否发生了变化
            if (deep || isRefSource || hasChanged(newValue, oldValue)) {
                if (cleanup) {
                    cleanup()
                }
                // 通知副作用回调
                callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
                    newValue,
                    // pass undefined as the old value when it's changed for the first time
                    oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
                    onInvalidate
                ])
                // 修改旧值
                oldValue = newValue
            }
        } else {
            // watchEffect 情况下
            runner()
        }
    }

    job.allowRecurse = !!cb
    ```  

5. 初始化  
    
    ```typescript
    if (cb) {
        if (immediate) {
            job()
        } else {
            oldValue = runner()
        }
    } else if (flush === 'post') {
        queuePostRenderEffect(runner, instance && instance.suspense)
    } else {
        runner()
    }
    ```  

    对于 `watch` 来说，如果带有 `immediate`，则会立即执行 `job`，从而立即触发副作用，否则只是调用 `runner`，将值存在 `oldValue` 中，以供下次使用  
    对于 `watchEffect` 来说，调用 `runner` 就会调用副作用，如果 `flush` 是 `post`，则会将 `runner` 至于 `post` 队列中等待调用，否则会同步调用  

6. 定义 清除副作用的函数  
    可以看到，只要在调用副作用的地方，无论是 `watch` 还是 `watchEffect`，都会传递一个参数 `onInvalidate`，这个函数的作用就是清除副作用  
    例如在副作用中会监听某个事件，而什么时候需要移除这个事件，就是在清除副作用的时候  
    `onInvalidate` 接受一个函数，这个函数里就是清除副作用时具体要做的事  

    ```typescript
    let cleanup: () => void
    const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
        cleanup = runner.options.onStop = () => {
            callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
        }
    }
    ```  

    可以看到，调用 `onInvalidate` 时，会将同一个函数挂载在 `cleanup` 以及 `runner.options.onStop` 上，这样，当每次调用副作用前，先会调用 `cleanup` 清除所有的副作用，当停止监听这个 `effect` 对象时(组件卸载时会停止)，也会调用 `cleanup` 来清除副作用  

7. 处理深层响应  
    深层响应主要是针对嵌套的对象，如果嵌套层级较深，当修改深层数据时，也需要触发副作用回调，就需要开启这个功能，有两种方式可以开启  
    1. 指定配置对象中的 `deep` 为 `true`  
    2. 如果监听的值为 `reactive` 响应对象，则会默认开启   

    **注意，深层响应只会在 `watch` 里面**  
    
    ```typescript
    if (cb && deep) {
        const baseGetter = getter
        getter = () => traverse(baseGetter())
    }
    ```  

8. 返回停止监听的函数  
    `doWatch` 最终会返回一个函数，这个函数用来手动停止监听

    ```typescript
    return () => {
        // 停止 effect 监听
        stop(runner)
        if (instance) {
            // 从 instance.effects 移除 runner
            remove(instance.effects!, runner)
        }
    }
    ```  

# traverse  
这个函数主要用来做深层响应，原理就是监听对象里的每个属性，包括可迭代的属性，这样，不管是新增、移除、修改都可以监听到  

```typescript
function traverse(value: unknown, seen: Set<unknown> = new Set()) {
    // 非对象以及监听过的，不会再处理
    if (!isObject(value) || seen.has(value)) {
        return value
    }
    // 记录每个对象，避免重复监听
    seen.add(value)
    
    if (isRef(value)) {
        traverse(value.value, seen)
    } else if (isArray(value)) {
        // 数组会监听 length 以及每个索引
        for (let i = 0; i < value.length; i++) {
            traverse(value[i], seen)
        }
    } else if (isMap(value)) {
        // Map 对象会监听每个 key 以及遍历属性
        value.forEach((_, key) => {
            traverse(value.get(key), seen)
        })
    } else if (isSet(value)) {
        // Set 对象会监听每个 key 以及遍历属性
        value.forEach(v => {
            traverse(v, seen)
        })
    } else {
        // 普通对象会监听每个 key 以及遍历属性 iterator
        for (const key in value) {
            traverse(value[key], seen)
        }
    }
    return value
}
```  

# 示例  
## 监听组件 props  

```typescript
const a = ref(0)
const b = ref(0)
const c = ref(0)
const calls: string[] = []

const Comp = {
    props: ['a', 'b'],
    setup(props: any) {
        // watch1
        watch(
            () => props.a + props.b,  // effect -> props.a/props.b
            () => {
                calls.push('watcher 1')
                c.value++
            },
            { flush: 'pre' }
        )

        // watch2
        watch(  // effect -> c.value
            c,
            () => {
                calls.push('watcher 2')
            },
            { flush: 'pre' }
        )
        
        return () => {
            c.value
            calls.push('render')
        }
    }
}

const App = {
    render() {
        return h(Comp, { a: a.value, b: b.value })
    }
}

render(h(App), nodeOps.createElement('div'))

console.log(calls); // ['render']

a.value++
b.value++

await nextTick()

console.log(calls); // ['render', 'watcher 1', 'watcher 2', 'render']
```  

首先，需要清楚挂载完成后，`targetMap` 的内容如下  

```typescript
targetMap: {
	a: {
		value: [ App 更新函数 update ]
	},
	b: {
		value: [ App 更新函数 update ]
	},
	props: {
		a: [ watch1 ],
		b: [ watch1 ]
	},
	c: {
		value: [ watch2, Comp 更新函数 update ]
	}
}
```  

1. 修改 `a` 和 `b`，导致 `App.update` 入队 `queue` 中，等到异步任务开始时，执行 `App.update` 重新渲染 `Comp` 组件  
2. 经过 `patch` `Comp` 组件，发生 `props` 发生了变化，进入 [updateComponentPreRender](#updateComponentPreRender) -> [updateProps](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/props/README.md#%E6%9B%B4%E6%96%B0-props) 中更新组件实例上的 `props`(`props`是响应对象)  
    * 更新 `props.a`，触发 `watch1` 的调度器，使得 `watch1` 的 `job` 入队 `pre`  
    * 更新 `props.b`，触发 `watch1` 的调度器，使得 `watch1` 的 `job` 入队 `pre`  
    
    在 [updateComponentPreRender](#updateComponentPreRender) 内，更新完后会手动调用 [flushPreFlushCbs](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/scheduler/README.md#flushpreflushcbs) 来刷新 pre 队列   
    注意，这里传递了 `Comp.update` 函数，所以之后如果再次对 `Comp.update` 入队是不会成功的  
     
    * 对 `pre` 队列去重，只会留下一个 job，调用 job，重新计算 `watch1` 的监听值，发现存在变化，调用副作用，又修改了 `c.value`  
        调用 `watch2` 的调度器，将 `watch2` 的 `job` 入队 `pre`  
        调用 `Comp.update` 的调取器，将 `Comp.update` 入队 `queue`，入队失败  

    * 递归刷新 `pre` 队列，执行 `watch2` 的 `job`，[updateComponentPreRender](#updateComponentPreRender) 阶段执行完成  
    * 之后调用 `render` 函数，将新老 `children` 比较

