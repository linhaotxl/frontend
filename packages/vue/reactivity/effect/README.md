> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [副作用](#副作用)
    - [targetMap](#targetmap)
    - [副作用 effect 的创建](#副作用-effect-的创建)
        - [effect](#effect)
        - [createReactiveEffect](#createreactiveeffect)
    - [副作用收集的状态](#副作用收集的状态)
        - [开启收集](#开启收集)
        - [暂停收集](#暂停收集)
        - [恢复收集](#恢复收集)
    - [副作用的收集与触发](#副作用的收集与触发)
        - [track](#track)
        - [trigger](#trigger)
    - [其他](#其他)
        - [cleanUp](#cleanup)
        - [stop](#stop)
- [示例](#示例)
    - [清除追踪](#清除追踪)

<!-- /TOC -->

# 副作用
副作用：当我们监听一个变量时，期望在这个变量发生变化的时候，去执行一些额外的操作，这个额外的操作就是 “副作用”  
例如在 `vue` 中，更新状态后，会去重新渲染组件，那么 “重新渲染组件” 这个操作就是一个副作用  

## targetMap
这是一个全局变量，存储的是 *监听的值* 与 *副作用* 之间的关系，它的定义如下  

```typescript
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()
```   

`targetMap` 是一个 `Map`，而它的 *值* 又是一个 `Map`，这个 `Map` 的值是一个 `Set` 集合，大致是下面这个样子  

```typescript
targetMap: {
    监听对象: {
        对象下的属性: [ 副作用1, 副作用2 ]
    }
}
```  

在追踪副作用的过程 [track](#track) 中，会向里面添加副作用，在触发副作用的过程 [trigger](#trigger) 中，会从中取出副作用，然后执行  

## 副作用 effect 的创建  
副作用的外面其实还有一层，就是 **`effect` 函数**，这个函数的结构如下  

```typescript
export interface ReactiveEffect<T = any> {
    (): T
    _isEffect: true                 // 标识是否是 effect 函数
    id: number                      // 唯一 id
    active: boolean                 // 是否可以工作
    raw: () => T                    // 原始函数
    deps: Array<Dep>                // 所有的依赖
    options: ReactiveEffectOptions  // 配置
}
```  

`raw`: `effect` 函数内部会调用真正需要执行的 *副作用*，会将其挂载在 `raw` 属性上  
`deps`: 保存了监听某个属性的所有副作用的集合  

配置选项结构如下  

```typescript
export interface ReactiveEffectOptions {
    lazy?: boolean                                  // 是否立即执行原始的副作用函数
    scheduler?: (job: ReactiveEffect) => void       // 调度器
    onTrack?: (event: DebuggerEvent) => void        // 追踪时触发的钩子函数
    onTrigger?: (event: DebuggerEvent) => void      // 触发副作用的钩子函数
    onStop?: () => void                             // 停止 effect 工作的钩子函数
    allowRecurse?: boolean
}
```  

`scheduler`: 调度器的任务就是决定如何去调用原始的副作用函数    
 * 默认情况下，当监听的值发生改变，就会取调用 `effect` 函数，从而调用副作用函数  
 * 存在调度器，并不会立即调用原始函数，而是调用调度器，有调度器决定如何带哦用原始函数  

### effect

```typescript
/**
 * @param { Function } fn 原始副作用函数
 * @param { ReactiveEffectOptions } options 配置对象 
 */
export function effect<T = any>(
    fn: () => T,
    options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
    // 如果传入的 fn 已经是一个 effect 函数，那么会修改 fn 为传入 effect 的原始函数
    // 接下来创建的 effect 函数也是基于同样的原始函数
    if ( isEffect( fn ) ) {
        fn = fn.raw
    }

    // 创建 effect 函数
    const effect = createReactiveEffect(fn, options)

    // 检测是否需要立即执行
    if (!options.lazy) {
        effect()
    }

    // 返回 effect 函数
    return effect
}
```  


### createReactiveEffect

```typescript
const effectStack: ReactiveEffect[] = []        // effect 栈
let activeEffect: ReactiveEffect | undefined    // 当前正在执行的 effect 函数
```  

```typescript
function createReactiveEffect<T = any>(
    fn: () => T,
    options: ReactiveEffectOptions
): ReactiveEffect<T> {
    // effect 函数
    const effect = function reactiveEffect(): unknown {
        if (!effect.active) {
            return options.scheduler ? undefined : fn()
        }

        if ( !effectStack.includes( effect ) ) {
            // 清除所有的追踪，fn 可能存在逻辑判断，所以需要重新计算追踪的属性
            cleanup( effect )
            try {
                enableTracking()
                effectStack.push(effect)
                activeEffect = effect
                return fn()
            } finally {
                effectStack.pop()
                resetTracking()
                activeEffect = effectStack[effectStack.length - 1]
            }
        }
    } as ReactiveEffect

    // 挂载相关属性
    effect.id = uid++
    effect._isEffect = true
    effect.active = true
    effect.raw = fn
    effect.deps = []
    effect.options = options
    
    return effect
}
```  

每次触发副作用，都会经过 `effect` 函数才会触发，在 [targetMap](#targetMap) 存储的副作用也是 `effect` 函数，而非原始函数  

## 副作用收集的状态  
可以通过 开启、暂停、恢复三种操作收集的状态，从 [effect函数](#createReactiveEffect) 函数中可以看到，在执行副作用函数之前，会开启收集，收集结束之后，会恢复  

```typescript
let shouldTrack = true              // 当前收集的状态
const trackStack: boolean[] = []    // 收集状态栈
```  

### 开启收集

```typescript
export function enableTracking() {
    // 将当前状态先入栈，再更新当前状态为 true 表示可以收集
    trackStack.push(shouldTrack)
    shouldTrack = true
}
```  

### 暂停收集

```typescript
export function pauseTracking() {
    // 将当前状态先入栈，再更新当前状态为 false 表示暂停收集
    trackStack.push(shouldTrack)
    shouldTrack = false
}
```  

### 恢复收集

```typescript
export function resetTracking() {
    // 从栈中获取上一个状态，再更新当前状态，默认为 true 表示开启
    const last = trackStack.pop()
    shouldTrack = last === undefined ? true : last
}
```  

## 副作用的收集与触发

### track  
这个函数主要在获取响应对象的属性时被调用，从而追踪

```typescript
export function track(target: object, type: TrackOpTypes, key: unknown) {
    // 如果当前暂停了追踪，或者当前没有正在执行的 effect，那么直接退出，不需要追踪
    if ( !shouldTrack || activeEffect === undefined ) {
        return
    }

    // 从 targetMap 中获取 “监听对象” 集合
    let depsMap = targetMap.get( target )
    if ( !depsMap ) {
        targetMap.set(target, (depsMap = new Map()))
    }

    // 从 “监听对象” 集合中获取 “对象下的属性” 的集合
    let dep = depsMap.get( key )
    if ( !dep ) {
        depsMap.set(key, (dep = new Set()))
    }

    // 检测集合中是否存在当前 effect 函数
    if ( !dep.has( activeEffect ) ) {
        // 将当前 effect 函数添加到 “对象下的属性” 集合中，在 targetMap 中形成映射关系
        dep.add( activeEffect )
        // ① 将 “对象下的属性” 集合添加到 effect 函数内
        activeEffect.deps.push( dep )

        // 触发追踪时的钩子函数
        if (__DEV__ && activeEffect.options.onTrack) {
            activeEffect.options.onTrack({
                effect: activeEffect,
                target,
                type,
                key
            })
        }
    }
}
```  

1. 在 ① 处，会将 “对象下的属性” 集合存入 `effect` 函数内，这一步主要的作用在于 [清除追踪的属性](#cleanUp) 内  

### trigger  

## 其他  

### cleanUp  
首先要明确的是，在 `effect.depts` 中，存储的是 *当前 effect 追踪的属性对应的集合*，一个属性可能会被多个 `effect` 追踪，所以这个集合中可能会存在多个 `effect` 函数  
每次执行 `effect` 函数时，都会先清除当前 `effect` 追踪的属性，然后再执行副作用函数，这样做的目的就是保证 `effect` 追踪的属性始终是最新的，参考 [示例](#清除追踪)  

```typescript
/**
 * 清除追踪的属性
 * @param effect 操作的 effect
 */
function cleanup( effect: ReactiveEffect ) {
    // effect.deps 里的 Set 指向 targetMap 中的 Set，所以也就是删除了 targetMap 中的数据
    // 获取 effect 追踪的依赖集合，删除指定的 effect 函数，最后清除当前 effect 所有的追踪
    const { deps } = effect
    if ( deps.length ) {
        for ( let i = 0; i < deps.length; i++ ) {
            deps[i].delete( effect )
        }
        deps.length = 0
    }
}
```  

在 [targetMap](#targetMap) 属性集合中，可能会存在多个 `effect` 函数，这里仅仅删除了和当前相关的 `effect`，剩余的还是存在的  

### stop



# 示例  

## 清除追踪  

```typescript
let dummy
const original = { prop: 'value', run: true };
const obj = reactive(original)

const conditionalSpy = jest.fn(() => {
    dummy = obj.run ? obj.prop : 'other'
})

// ①
const effect1 = effect(conditionalSpy)

expect(dummy).toBe('value')
expect(conditionalSpy).toHaveBeenCalledTimes(1)

// ②
obj.run = false
expect(dummy).toBe('other')
expect(conditionalSpy).toHaveBeenCalledTimes(2)

// ③
obj.prop = 'value2'
expect(dummy).toBe('other')
expect(conditionalSpy).toHaveBeenCalledTimes(2)
```  

在 ① 处执行 `effect` 后，`targetMap` 是如下这样  

```typescript
{
    original: {
        run: [effect1],
        prop: [effect1],
    }
}
```  

在 ② 处执行 `setter` 触发 `effect1` 后，首先会清空 `effect1` 所有追踪的属性，即 `targetMap` 变为下面这样  

```typescript
{
    original: {
        run: [],
        prop: [],
    }
}
```  

接着再次执行副作用函数，此时 `run` 为 `false`，所以不再执行 `obj.prop`，也就不会再追踪 `prop` 了，`targetMap` 如下  

```typescript
{
    original: {
        run: [effect1],
        prop: [],
    }
}
```  

最后在 ③ 处修改 prop 也就无法再次触发 `effect1` 了  

