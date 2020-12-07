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
    - [直接修改数组length](#直接修改数组length)
    - [过滤正在执行的effect](#过滤正在执行的effect)

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
/**
 * 追踪属性
 * @param { object }        target  // 原始对象
 * @param { TrackOpTypes }  type    // 追踪类型
 * @param { unknown }       key     // 追踪属性
 */
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
当修改了监听的值时，就会通过这个方法，触发追踪的 `effect` 函数，从而执行副作用函数；在 `reactive`、`ref` 中的 `setter` 都会执行  

```typescript
export function trigger(
    target: object,
    type: TriggerOpTypes,
    key?: unknown,
    newValue?: unknown,
    oldValue?: unknown,
    oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
    // 从 targetMap 中获取 “监听对象” 集合
    const depsMap = targetMap.get(target)
    if (!depsMap) {
        // 如果不存在，则说明还没有对属性 key 进行追踪，直接退出
        return
    }

    // 定义需要执行的 effect 函数集合，即操作属性 key 会导致哪些 effect 函数被调用，后面会里面添加
    const effects = new Set<ReactiveEffect>()

    // ①
    // 向 effects 集合中添加 effect 函数
    const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
        if ( effectsToAdd ) {
            effectsToAdd.forEach(effect => {
                // 过滤掉正在触发的 effect 内，例如在一个 effect 内，先追踪了依赖，再触发了依赖
                if (effect !== activeEffect || effect.options.allowRecurse) {
                    effects.add(effect)
                }
            })
        }
    }

    // 处理不同的操作
    if ( type === TriggerOpTypes.CLEAR ) {
        // ②
        // 针对 Map 和 Set 的 clear 操作，此时清除了所有数据，所以需要触发所有追踪的属性，遍历 “属性集合”，将每一个 effect 函数都加入到 effects 中
        depsMap.forEach( add )
    } else if (key === 'length' && isArray(target)) {
        // ③
        // 针对直接修改数组的 length 属性
        depsMap.forEach((dep, key) => {
            if (key === 'length' || key >= (newValue as number)) {
                add(dep)
            }
        })
    } else {
        // 新增、更新、删除操作
        // 对于新增的操作，由于 key 是新增的，所以 depsMap.get( key ) 是不存在的，所以这里什么也不会做
        if ( key !== void 0 ) {
            add( depsMap.get( key ) )
        }

        // 向 effects 集合中添加遍历的 effect 函数，当存在新增、删除时就需要触发遍历的 effect 函数
        switch (type) {
            // 添加属性时
            // 如果是普通对象会触发遍历(ITERATE_KEY) effect 函数，Map 还会多添加一个 MAP_KEY_ITERATE_KEY effect 函数
            // 如果数组，并且添加的 key 是索引，那么会触发 length 的 effect 函数
            case TriggerOpTypes.ADD:
                if (!isArray(target)) {
                    add(depsMap.get(ITERATE_KEY))
                    if (isMap(target)) {
                        add(depsMap.get(MAP_KEY_ITERATE_KEY))
                    }
                } else if (isIntegerKey(key)) {
                    add(depsMap.get('length'))
                }
                break
            // 删除属性时
            // 如果是普通对象会触发遍历(ITERATE_KEY) effect 函数，Map 还会多添加一个 MAP_KEY_ITERATE_KEY effect 函数
            // 通过 delete 删除数组元素，长度是不会改变的，所以不需要触发 length 的依赖
            case TriggerOpTypes.DELETE:
                if (!isArray(target)) {
                    add(depsMap.get(ITERATE_KEY))
                    if (isMap(target)) {
                        add(depsMap.get(MAP_KEY_ITERATE_KEY))
                    }
                }
                break
            // Map 的更新新增都是通过 set 方法完成的，所以如果是 Map 的更新操作，也需要触发遍历(ITERATE_KEY) 的 effect 函数
            case TriggerOpTypes.SET:
                if (isMap(target)) {
                    add(depsMap.get(ITERATE_KEY))
                }
                break
        }
    }

    // 执行 effects 中的 effect 函数
    const run = ( effect: ReactiveEffect ) => {
        if (__DEV__ && effect.options.onTrigger) {
            effect.options.onTrigger({
                effect,
                target,
                key,
                type,
                newValue,
                oldValue,
                oldTarget
            })
        }
        // 如果 effect 存在调度器 scheduler，就调用调度器，有调度器决定什么时候触发 effect 函数；否则就直接调用 effect 函数
        if ( effect.options.scheduler ) {
            effect.options.scheduler( effect )
        } else {
            effect()
        }
    }

    effects.forEach(run)
}
```  

1. 在 ① 处的 add 函数，遍历时进行过滤，一种是当前正在执行的 `effect` 函数，参考 [示例](#过滤正在执行的effect)  
2. 在 ③ 处针对直接修改数组长度的情况，肯定需要触发追踪 length 的 effect，其次，修改长度后，从长度开始的索引一直到结尾，这区间的元素都会被删除，所以也需要触发这个区间追踪的 `effect` 函数，参考 [示例](#直接修改数组length)  

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
这个函数用来停止一个 `effect` 函数，停止后，这个 `effect` 函数会清空所有追踪的属性  

```typescript
export function stop(effect: ReactiveEffect) {
    if (effect.active) {
        // 清除追踪的属性
        cleanup(effect)
        // 执行停止钩子函数
        if (effect.options.onStop) {
            effect.options.onStop()
        }
        // 标识 effect 已经停止
        effect.active = false
    }
}
```  

注意，如果一个 `effect` 停止后，它追踪的所有属性都会被清空，再次修改监听的值，在 [trigger](#trigger) 内也就无法找到 `effect` 函数了，也就无法再次执行
但是仍然可以通过手动执行 `effect` 函数，来触发副作用函数，在 [createReactiveEffect](#createReactiveEffect) 中可以看到，调用一个停止的 `effect`，如果有调度器则什么也不会做，否则会调用原始副作用函数  

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

## 直接修改数组length  

```typescript
const const original = [1, 2];
const observal = reactive(original);
let dummy, dummy0, dummy1, dummy2;

// effect1 追踪 length
const effect1 = effect(() => {
    dummy = observal.length;
});

// effect2 追踪 0
const effect2 = effect(() => {
    dummy0 = observal[0];
});

// effect3 追踪 1
const effect3 = effect(() => {
    dummy1 = observal[1];
});

// effect4 追踪 2
const effect4 = effect(() => {
    dummy2 = observal[2];
});

expect(dummy).toBe(2);
expect(dummy0).toBe(1);
expect(dummy1).toBe(2);
expect(dummy2).toBeUndefined();

// 增加 2 属性，触发 length 和 2 对应的 effect 函数
observal[2] = 3;

expect(dummy).toBe(3);
expect(dummy0).toBe(1);
expect(dummy1).toBe(2);
expect(dummy2).toBe(3);

// ①
observal.length = 1;

expect(dummy).toBe(1);
expect(dummy0).toBe(1);
expect(dummy1).toBeUndefined();
expect(dummy2).toBeUndefined();
```  

targetMap 是如下这样  

```typescript
{
    original: {
        length: [effect1],
        0: [effect2],
        1: [effect3],
        2: [effect4],
    }
}
```  

在 ① 处修改长度，会进入 [trigger](#trigger) 的 ③ 处，会触发 `length`，以及大于等于长度 1 的索引(1, 2)，即触发 `effect1`、`effect2`、`effect3`  

## 过滤正在执行的effect  

```typescript
const counter = reactive({ num: 0 })

const counterSpy = jest.fn(() => {
    counter.num++
})

// 追踪 num 属性
const effect1 = effect(counterSpy)
expect(counter.num).toBe(1)
expect(counterSpy).toHaveBeenCalledTimes(1)

counter.num = 4

expect(counter.num).toBe(5)
expect(counterSpy).toHaveBeenCalledTimes(2)
```  

在执行副作用中，`activeEffect` 就是 `effect1`，首先追踪了 `num` 属性，接着又对其进行了修改，通过 [trigger](#trigger) 触发追踪 `num` 的 `effect`，但是追踪 `num` 的 `effect` 和当前正在执行的 `activeEffect` 是同一个，所以不会触发任何的 `effect` 函数  

