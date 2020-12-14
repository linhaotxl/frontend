> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [工具函数](#工具函数)
- [集合拦截对象](#集合拦截对象)
    - [createInstrumentationGetter](#createinstrumentationgetter)
- [instrumentations](#instrumentations)
    - [mutableInstrumentations](#mutableinstrumentations)
    - [shallowInstrumentations](#shallowinstrumentations)
    - [readonlyInstrumentations](#readonlyinstrumentations)
- [拦截方法](#拦截方法)
    - [get](#get)
    - [set](#set)
    - [add](#add)
    - [has](#has)
    - [deleteEntry](#deleteentry)
    - [size](#size)
    - [clear](#clear)
    - [forEach](#foreach)
    - [迭代器](#迭代器)
        - [迭代器创建](#迭代器创建)
        - [createIterableMethod](#createiterablemethod)
    - [createReadonlyMethod](#createreadonlymethod)

<!-- /TOC -->

# 工具函数  

1. `toReactive`  
转换为普通响应对象  

    ```typescript
    const toReactive = <T extends unknown>(value: T): T => isObject(value) ? reactive(value) : value
    ```  

2. `toReadonly`  
转换为只读响应对象  

    ```typescript
    const toReadonly = <T extends unknown>(value: T): T => isObject(value) ? readonly(value as Record<any, any>) : value
    ```  

3. `toShallow`  
转换为浅响应对象，由于浅响应对象不会深层处理，所以只需要获取自身即可  

    ```typescript
    const toShallow = <T extends unknown>(value: T): T => value
    ```  

4. `getProto`  
获取原型对象，之后主要获取集合对象的原生方法  

    ```typescript
    const getProto = <T extends CollectionTypes>(v: T): any => Reflect.getPrototypeOf(v)
    ```  



# 集合拦截对象  
1. 普通集合对象拦截 `mutableCollectionHandlers`  

    ```typescript
    export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
        get: createInstrumentationGetter(false, false)
    }
    ```  

2. 普通集合浅响应对象拦截 `shallowCollectionHandlers`  

    ```typescript
    export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
        get: createInstrumentationGetter(false, true)
    }
    ```
 
3. 只读集合对象拦截 `readonlyCollectionHandlers`  

    ```typescript
    export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
        get: createInstrumentationGetter(true, false)
    }
    ```

可以发现，不管哪一种拦截对象，都只拦截了 `get` 操作，这是因为集合对象不管是新增、更新、检测是否存在以及删除，都必须要通过方法来实现，无法通过执行命令实现，例如 `delete`、`in` 等  

## createInstrumentationGetter  
这个函数是个工厂函数，用于创建 `get` 的拦截函数  

```typescript
/**
 * @param { boolean } isReadonly 是否只读
 * @param { boolean } shallow    是否浅响应
 */
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
    const instrumentations = shallow
        ? shallowInstrumentations
        : isReadonly
            ? readonlyInstrumentations
            : mutableInstrumentations

    // 实际的 get 拦截函数
    return (
        target: CollectionTypes,
        key: string | symbol,
        receiver: CollectionTypes
    ) => {
        // 这里的逻辑和 baseHandlers 一样
        if (key === ReactiveFlags.IS_REACTIVE) {
            return !isReadonly
        } else if (key === ReactiveFlags.IS_READONLY) {
            return isReadonly
        } else if (key === ReactiveFlags.RAW) {
            return target
        }

        return Reflect.get(
            hasOwn(instrumentations, key) && key in target
                ? instrumentations
                : target,
            key,
            receiver
        )
    }
}
```  

创建出来的 `get` 拦截函数只是一个通用的模板，具体会调用 `instrumentations` 里面的函数来执行真正的操作  

# instrumentations  
这个对象会根据是否只读，是否浅响应来设置，无非就是 `mutableInstrumentations`、`shallowInstrumentations`、`readonlyInstrumentations` 三个中的一个，这三个对象中会定义与原生方法同名的函数，例如 `get`、`set` 等等，所以我们实际调用的是这些函数，通过这些函数再去调用原生方法  

## mutableInstrumentations  
这个对象用于非只读，非浅响应的普通对象中  

```typescript
const mutableInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
        return get(this, key)
    },
    get size() {
        return size((this as unknown) as IterableCollections)
    },
    has,
    add,
    set,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, false)
}
```  

## shallowInstrumentations  
这个对象用于普通浅响应对象中  

```typescript
const shallowInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
        return get(this, key, false, true)
    },
    get size() {
        return size((this as unknown) as IterableCollections)
    },
    has,
    add,
    set,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, true)
}
```  

## readonlyInstrumentations  
这个对象用于只读对象中，无论是否是浅响应  

```typescript
const readonlyInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
        return get(this, key, true)
    },
    get size() {
        return size((this as unknown) as IterableCollections, true)
    },
    has(this: MapTypes, key: unknown) {
        return has.call(this, key, true)
    },
    add: createReadonlyMethod(TriggerOpTypes.ADD),
    set: createReadonlyMethod(TriggerOpTypes.SET),
    delete: createReadonlyMethod(TriggerOpTypes.DELETE),
    clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
    forEach: createForEach(true, false)
}
```  

**注意，在上上面的操作中，存在将 `this` 传递给函数的情况，这里的 `this` 指向的就是调用者响应对象**  

最后，又为这三个对象添加了 *迭代器* 相关的拦截  

```typescript
const iteratorMethods = [
    'keys',             // 获取键集合
    'values',           // 获取值集合
    'entries',          // 获取键值对集合
    Symbol.iterator     // for..of 操作
]
iteratorMethods.forEach(method => {
    mutableInstrumentations[method as string] = createIterableMethod(
        method,
        false,
        false
    )
    readonlyInstrumentations[method as string] = createIterableMethod(
        method,
        true,
        false
    )
    shallowInstrumentations[method as string] = createIterableMethod(
        method,
        false,
        true
    )
})
```  

接下来一个一个看具体的实现过程  

# 拦截方法  

## get  
定义了 `Map` 对象的 `get` 拦截函数  

```typescript
function get(
    target: MapTypes,   // 响应式 Map 对象
    key: unknown,       // 获取的 key
    isReadonly = false, // 是否只读 
    isShallow = false   // 是否浅响应
) {
    // ① 将 target 重写为它的原始对象，这一步主要是处理 readonly(reactive(Map)) 的情况
    target = (target as any)[ReactiveFlags.RAW]

    // 获取 target 原始对象和原始 key
    const rawTarget = toRaw(target)
    const rawKey = toRaw(key)

    // 原始 key 和访问的 key 不一致，说明访问的 key 是一个响应式对象，那么也需要追踪这个响应式对象
    if (key !== rawKey) {
        !isReadonly && track(rawTarget, TrackOpTypes.GET, key)
    }

    // 非只读下，追踪原始 key
    !isReadonly && track(rawTarget, TrackOpTypes.GET, rawKey)
    
    const { has } = getProto(rawTarget)
    const wrap = isReadonly ? toReadonly : isShallow ? toShallow : toReactive
    
    // 获取真正的值，如果为对象再对其进行响应化
    if (has.call(rawTarget, key)) {
        return wrap(target.get(key))
    } else if (has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey))
    }
}
```  

1. ① 处的目的是为了兼容 `readonly(reactive(new Map()))` 这种情况，看下面的代码  

    ```typescript
    const map = new Map()
    const observal = reactive()
    const roObserval = readonly(map)

    const key = {}
    map.set(key, {})

    // ①
    const item = observal.get(key)
    expect(isReactive(item)).toBe(true)
    expect(isReadonly(item)).toBe(false)

    // ②
    const roItem = roObserval.get(key)
    expect(isReactive(roItem)).toBe(true)
    expect(isReadonly(roItem)).toBe(true)
    ```  

    通过 `observal` 获取 `key`，`target` 本来是 `observal`，接着被重写为 `map`，`rawTarget` 也就是 `map` 了，再从 `target` 中取出的结果会被 `toReactive` 包裹成为一个响应对象  
    通过 `roObserval` 获取 `key`，`target` 本来是 `roObserval`，会被重写为 `observal`，`rawTarget` 也就是 `map` 了，再从 `target` 中取出结果，又触发了拦截，实际是从 `observal` 取出值，返回一个响应对象，最后再将响应对象通过 `toReadonly` 进行响应化  
    
    *Q1*：如果删除这句 `target = (target as any)[ReactiveFlags.RAW]` 可以吗  
    A：不行，如果删除，对于示例中的 ① 这种情况，会进入死循环：`target` 始终是一个响应对象，在最后通过 `target.get` 获取值的时候，又会进入 `get` 拦截，一直重复这个过程  

    *Q2*：如果将 `target = (target as any)[ReactiveFlags.RAW]` 替换为 `target = toRaw(target)` 可以吗  
    A：不行，通过 [toRaw](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/reactive/README.md#toraw) 的递归性，`target` 得到的将是最终的原始对象 `map`，这样在最后 `target.get` 的时候，结果只是一个经过 `toReadonly` 只读响应对象，而不是 `readonly` 包裹 `reactive`  
      
## set  
定义了 `Map` 的 `set` 拦截函数  

```typescript
function set(this: MapTypes, key: unknown, value: unknown) {
    // 将设置的值转换为原始值
    value = toRaw(value)
    const target = toRaw(this)
    const { has, get } = getProto(target)

    // 检查是新增还是更新操作，用于之后 trigger 的类型，会二次检查
    let hadKey = has.call( target, key )
    if ( !hadKey ) {
        // 将 key 转换为原始值，再次检查是否存在
        key = toRaw( key )
        hadKey = has.call( target, key )
    } else if (__DEV__) {
        checkIdentityKeys(target, has, key)
    }

    const oldValue = get.call(target, key)
    // 设置，key 和 value 都是原始值
    const result = target.set(key, value)
    if (!hadKey) {
        // 新增
        trigger(target, TriggerOpTypes.ADD, key, value)
    } else if (hasChanged(value, oldValue)) {
        // 更新
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
    }

    return result
}
```  

**可以看到，`Map` 设置 `key` 和 `value`，不管是否是响应对象，最终实际设置的 `key` 和 `value` 都是原始值**  

## add  
定义了 `Set` 的 `add` 拦截函数  

```typescript
function add(this: SetTypes, value: unknown) {
    // 将设置的值转换为原始值
    value = toRaw(value)
    const target = toRaw(this)
    const proto = getProto(target)
    const hadKey = proto.has.call(target, value)
    const result = target.add(value)
    if (!hadKey) {
        // 触发新增
        trigger(target, TriggerOpTypes.ADD, value, value)
    }
    return result
}
```  

**和 [set](#set) 一样，设置的值也是原始值**  

## has  
定义了 `Map` 和 `Set` 的 `has` 拦截函数，如果参数 `key` 是一个响应对象，那么不仅会追踪原始对象，也会追踪这个响应对象   

```typescript
function has(this: CollectionTypes, key: unknown, isReadonly = false): boolean {
    // 这一步的目的和 get 一样
    const target = (this as any)[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const rawKey = toRaw(key)
    if (key !== rawKey) {
        !isReadonly && track(rawTarget, TrackOpTypes.HAS, key)
    }
    !isReadonly && track(rawTarget, TrackOpTypes.HAS, rawKey)
    return key === rawKey
        ? target.has(key)
        : target.has(key) || target.has(rawKey) // 参数是一个响应对象，优先检测响应对象，再检测原始对象
}
```  

## deleteEntry  
定义了 `Map` 和 `Set` 的 `delete` 拦截函数  

```typescript
function deleteEntry(this: CollectionTypes, key: unknown) {
    const target = toRaw(this)
    const { has, get } = getProto(target)

    // 检测删除的 key 是否存在，不存在进行二次检测
    let hadKey = has.call(target, key)
    if (!hadKey) {
        key = toRaw(key)
        hadKey = has.call(target, key)
    } else if (__DEV__) {
        checkIdentityKeys(target, has, key)
    }

    // 获取删除前的值
    // Map: 调用 get 方法获取
    // Set: undefined
    const oldValue = get ? get.call(target, key) : undefined
   
    // 调用原生方法执行删除操作
    const result = target.delete(key)

    if (hadKey) {
        // 删除的是一个存在的值，触发删除操作
        trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    
    return result
}
```  

## size  

```typescript
function size(target: IterableCollections, isReadonly = false) {
    // 这一步的目的和 get 一样
    target = (target as any)[ReactiveFlags.RAW]
    // 触发追踪遍历的 effect
    !isReadonly && track(toRaw(target), TrackOpTypes.ITERATE, ITERATE_KEY)
    // 从原始对象中获取 size
    return Reflect.get(target, 'size', target)
}
```  

## clear  
定义 `Map` 和 `Set` 的 *清空* 操作  

```typescript
function clear(this: IterableCollections) {
    const target = toRaw(this)
    const hadItems = target.size !== 0
    const oldTarget = __DEV__
        ? isMap(target)
            ? new Map(target)
            : new Set(target)
        : undefined

    // 调用原生方法实现清除
    const result = target.clear()
    
    // 删除前存在内容，则触发 clear 的依赖，在 trigger 中，如果触发的是 clear 操作，那么会执行 target 所有的 effect
    if (hadItems) {
        trigger(target, TriggerOpTypes.CLEAR, undefined, undefined, oldTarget)
    }

    return result
}
```  

## forEach  
这是一个创建 `forEach` 的工厂函数，针对只读以及浅响应  

```typescript
function createForEach(isReadonly: boolean, isShallow: boolean) {
    return function forEach(
        this: IterableCollections,
        callback: Function,
        thisArg?: unknown
    ) {
        const observed = this as any
        const target = observed[ReactiveFlags.RAW]
        const rawTarget = toRaw(target)

        // 根据是否只读，浅响应封装包装函数
        const wrap = isReadonly ? toReadonly : isShallow ? toShallow : toReactive

        // 追踪遍历操作
        !isReadonly && track(rawTarget, TrackOpTypes.ITERATE, ITERATE_KEY)
        
        // 调用原生方法 forEach
        // 回调接受到的 key 和 value 都是经过包装的响应对象
        // 回调还接受第三个参数，即调用者自身
        return target.forEach((value: unknown, key: unknown) => {
            return callback.call(thisArg, wrap(value), wrap(key), observed)
        })
    }
}
```  

## 迭代器  
### 迭代器创建  

一个对象要是能被 `for..of` 访问，就必须要设置 `Symbol.iterator`，首先访问 `Symbol.iterator` 获取迭代器对象，接着会调用迭代器对象中的 `next` 函数，如果返回的 `done` 为 `false` 并且 `value` 不为 `undefined`，那么就会进入一次循环体，循环体结束后，再次调用 `next` 函数获取下一次循环体的值，直至 `done` 为 `true` 结束  

### createIterableMethod  
这个函数是创建迭代器操作的工厂函数  

```typescript
function createIterableMethod(
    method: string | symbol,
    isReadonly: boolean,
    isShallow: boolean
) {
    return function(
        this: IterableCollections,
        ...args: unknown[]
    ): Iterable & Iterator {
        const target = (this as any)[ReactiveFlags.RAW]
        const rawTarget = toRaw(target)
        const targetIsMap = isMap(rawTarget)
        
        // 检测是否是键值对的操作，Map 和 Set 的 entries 都是，同时还有 Map 的 for..of
        const isPair = method === 'entries' || (method === Symbol.iterator && targetIsMap)
        // 检测是否只是获取 key 的操作，只有在 Map.keys 属于
        const isKeyOnly = method === 'keys' && targetIsMap

        // 通过原生方法获取原生迭代器对象
        const innerIterator = target[method](...args)
        
        // 封装包装函数
        const wrap = isReadonly ? toReadonly : isShallow ? toShallow : toReactive

        // 追踪，默认追踪遍历 ITERATE_KEY
        // 如果访问的是 map.keys()，那么追踪的就是 MAP_KEY_ITERATE_KEY，即只追踪 key
        !isReadonly &&
        track(
            rawTarget,
            TrackOpTypes.ITERATE,
            isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
        )
        
        // 返回迭代器对象
        return {
            // 定义 next 方法
            next() {
                // 通过原生迭代器对象获取 done 和 value
                const { value, done } = innerIterator.next()
                return done
                    // 如果已经结束，则直接返回
                    ? { value, done }
                    // 如果没有结束，则对每个值进行包装处理
                    // isPair 为 true 则表示结束是 键值对，返回数据，否则直接返回值
                    : {
                        value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
                        done
                    }
            },
            // 定义 Symbol.iterator，返回 this，即 return 的对象，从其中调用 next 函数
            [Symbol.iterator]() {
                return this
            }
        }
    }
}
```  

## createReadonlyMethod  
这个函数用来创建 `readonly` 的修改拦截函数，`readonly` 禁止修改，所以这个函数里什么也不会做，只会抛出警告  

```typescript
function createReadonlyMethod(type: TriggerOpTypes): Function {
    return function(this: CollectionTypes, ...args: unknown[]) {
        // DEV 环境下抛出警告，禁止修改 readonly 响应对象
        if (__DEV__) {
            const key = args[0] ? `on key "${args[0]}" ` : ``
            console.warn(
                `${capitalize(type)} operation ${key}failed: target is readonly.`,
                toRaw(this)
            )
        }
        return type === TriggerOpTypes.DELETE ? false : this
    }
}
```  
