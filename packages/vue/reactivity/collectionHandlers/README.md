> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [集合拦截对象](#集合拦截对象)
    - [createInstrumentationGetter](#createinstrumentationgetter)
- [instrumentations](#instrumentations)
    - [mutableInstrumentations](#mutableinstrumentations)
    - [shallowInstrumentations](#shallowinstrumentations)
    - [readonlyInstrumentations](#readonlyinstrumentations)
- [拦截方法](#拦截方法)
    - [get](#get)
- [示例](#示例)
    - [get的兼容](#get的兼容)

<!-- /TOC -->

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

可以发现，不管哪一种拦截对象，都值拦截了 `get` 操作，这是因为集合对象不管是新增、更新、检测是否存在以及删除，都必须要通过方法来实现，无法通过执行命令实现，例如 `delete`、`in` 等  

## createInstrumentationGetter  
这个函数用于创建 `get` 的拦截  

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
这个对象会根据是否只读，是否浅响应来设置，无非就是 `mutableInstrumentations`、`shallowInstrumentations`、readonlyInstrumentations 三个中的一个，这三个对象中会拦截集合对象的原生方法，例如 `get`、`set` 等等，所以我们实际调用的是这些函数  

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

最后，又为这三个对象添加了遍历相关的拦截  

```typescript
const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
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
定义了 `Map` 对象的 `get` 拦截  

```typescript
function get(
    target: MapTypes,   // 响应式 Map 对象
    key: unknown,       // 获取的 key
    isReadonly = false, // 是否只读 
    isShallow = false   // 是否浅响应
) {
    // ① 这一步主要是处理 readonly(reactive(Map)) 的情况
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

1. ① 处的目的是为了兼容 `readonly(reactive(new Map()))` 这种情况，如果对一个已经是响应化的数据再次 `readonly`，那么获取值应该也是能获取到的，参考 [示例](#get的兼容)  

# 示例  

## get的兼容  

```typescript
const map = new Map()
const observal = reactive()
const roMap = readonly(map)

const key = {}
map.set(key, {})

// ①
const roItem = roMap.get(key)

expect(isReactive(roItem)).toBe(true)
expect(isReadonly(roItem)).toBe(true)
```  

通过 `roMap` 获取 `key` 时，会先使用 `roMap` 的原始对象(`observal`) 替换 `target`，接下来再获取 `target` 的原始对象(`map`)，
