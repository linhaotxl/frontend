> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [拦截对象](#拦截对象)
    - [mutableHandlers](#mutablehandlers)
    - [shallowReactiveHandlers](#shallowreactivehandlers)
    - [readonlyHandlers](#readonlyhandlers)
    - [shallowReadonlyHandlers](#shallowreadonlyhandlers)
- [非集合型](#非集合型)
    - [get 拦截](#get-拦截)
        - [arrayInstrumentations](#arrayinstrumentations)
        - [builtInSymbols](#builtinsymbols)
    - [set 拦截](#set-拦截)
    - [has 拦截](#has-拦截)
    - [deleteProperty 拦截](#deleteproperty-拦截)
    - [ownKeys  拦截](#ownkeys--拦截)
- [示例](#示例)
    - [数组查找元素](#数组查找元素)
    - [修改数组的length禁止追踪](#修改数组的length禁止追踪)
    - [访问 __proto__](#访问-__proto__)

<!-- /TOC -->

# 拦截对象  
通过 [reactive](#reactive)、[shallowReactive](#shallowReactive)、[readonly](#readonly) 以及 [shallowReadonly](#shallowReadonly) 这四个响应对象，我们知道一共有 7 种拦截对象，分别是  
1. [mutableHandlers](#mutableHandlers): 普通对象拦截  
2. [shallowReactiveHandlers](#shallowReactiveHandlers): 普通浅响应对象拦截  
3. [readonlyHandlers](#readonlyHandlers): 只读对象拦截  
4. [shallowReadonlyHandlers](#shallowReadonlyHandlers): 只读浅响应对象拦截  

5. [mutableCollectionHandlers](#mutableCollectionHandlers): 普通集合对象拦截  
6. [shallowCollectionHandlers](#shallowCollectionHandlers): 普通集合浅响应对象拦截  
7. [readonlyCollectionHandlers](#readonlyCollectionHandlers): 只读集合对象拦截  

下面依次来看这几个对象  

## mutableHandlers  
```typescript
export const mutableHandlers: ProxyHandler<object> = {
    get,
    set,
    deleteProperty,
    has,
    ownKeys
}
```  

## shallowReactiveHandlers  
只是重写了 get 和 set，其余都是复用 [mutableHandlers](#mutableHandlers) 的拦截  
  
```typescript
export const shallowReactiveHandlers: ProxyHandler<object> = extend(
    {},
    mutableHandlers,
    {
        get: shallowGet,
        set: shallowSet
    }
)
```  

## readonlyHandlers  
只读响应对象无法修改，所以 `set` 和 `deleteProperty` 什么都不会做，只是抛出警告
```typescript
export const readonlyHandlers: ProxyHandler<object> = {
    get: readonlyGet,
    set(target, key) {
        if (__DEV__) {
            console.warn(
                `Set operation on key "${String(key)}" failed: target is readonly.`,
                target
            )
        }
        return true
    },
    deleteProperty(target, key) {
        if (__DEV__) {
            console.warn(
                `Delete operation on key "${String(key)}" failed: target is readonly.`,
                target
            )
        }
        return true
    }
}
```  

## shallowReadonlyHandlers  
只读浅响应和只读响应一致，只不过重写了 `get` 拦截，其余都一致  

```typescript
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
    {},
    readonlyHandlers,
    {
        get: shallowReadonlyGet
    }
)
```  

# 非集合型  
从上面可以看出，非集合型的拦截对象就是那几个，接下来先看看它们是如何定义的   

## get 拦截

```typescript
const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)
```  

`get` 拦截对象都是通过工厂函数 `createGetter` 生成的，这个函数接受两个参数  
1. 是否只读，默认为 `false`  
2. 是否浅响应，默认为 `false`  

```typescript
/**
 * get 拦截工厂函数
 */
function createGetter(isReadonly = false, shallow = false) {
    return function get(target: Target, key: string | symbol, receiver: object) {
        // 检测属性来源，主要用于 isReactive、isReadonly 中
        if (key === ReactiveFlags.IS_REACTIVE) {
            return !isReadonly
        } else if (key === ReactiveFlags.IS_READONLY) {
            return isReadonly
        } else if (
            key === ReactiveFlags.RAW &&
            receiver === (isReadonly ? readonlyMap : reactiveMap).get(target)
        ) {
            return target
        }

        const targetIsArray = isArray(target)
        if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
            // 当访问的是数组的内置函数时，会调用封装过的，而不是直接调用原生函数
            return Reflect.get(arrayInstrumentations, key, receiver)
        }

        // 获取属性值
        const res = Reflect.get(target, key, receiver)

        // 检测访问的属性是否是 Symbol
        const keyIsSymbol = isSymbol(key)
        if (
            keyIsSymbol
                ? builtInSymbols.has(key as symbol)             // 访问的是内置 Symbol
                : key === `__proto__` || key === `__v_isRef`    // 访问的是 __proto__ 或者 __v_isRef
        ) {
            // 内置属性不再追踪处理，直接返回
            return res
        }

        // 非只读响应，开始对 target 的 key 进行追踪
        if (!isReadonly) {
            track(target, TrackOpTypes.GET, key)
        }

        // 如果是浅响应，直接返回获取到的 res
        if (shallow) {
            return res
        }

        if (isRef(res)) {
            // ref unwrapping - does not apply for Array + integer key.
            const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
            return shouldUnwrap ? res.value : res
        }

        // 如果 res 是个对象，则再根据是否只读对其进行响应化，并返回结果
        if (isObject(res)) {
            return isReadonly ? readonly(res) : reactive(res)
        }

        // 返回 res，此时不是对象、也不是 ref
        return res
    }
}
```  

1. 在 [isReadonly](#isReadonly)、[isReactive](#isReactive) 中都会访问 `IS_READONLY`、`IS_REACTIVE` 属性，此时就会被拦截，而结果就取决于闭包参数中的 `isReadonly`，只要不是只读，就是响应式的  

### arrayInstrumentations  
这个对象里拦截了数组的几个函数，扩展了一些额外功能，当我们通过数组调用这些函数时，实际上调用的是拦截的函数了，而不是原始的  

```typescript
const arrayInstrumentations: Record<string, Function> = {}

// 对以下查询函数做了额外处理
;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    // 获取原生函数
    const method = Array.prototype[key] as any
    arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
        // 获取原始对象，追踪数组里的每个元素
        const arr = toRaw(this)
        for (let i = 0, l = this.length; i < l; i++) {
            track(arr, TrackOpTypes.GET, i + '')
        }
        // 调用原生函数获取结果
        const res = method.apply(arr, args)
        // 如果没有插查到指定元素，则将参数转换为原始对象再查一遍
        if (res === -1 || res === false) {
            return method.apply(arr, args.map(toRaw))
        } else {
            return res
        }
    }
})

// 对以下修改 length 的函数做了额外处理
// 如果追踪了 length，那么在新增元素的时候，会触发 length 的依赖，导致循环调用
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    const method = Array.prototype[key] as any
    arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
        pauseTracking()
        const res = method.apply(this, args)
        enableTracking()
        return res
    }
})
```  

查询操作可以参考 [示例](#数组查找元素)，新增操作可以参考 [示例](#修改数组的length禁止追踪)  

### builtInSymbols  
存储所有内置 `Symbol` 值  

```typescript
const builtInSymbols = new Set(
    Object.getOwnPropertyNames(Symbol)
        .map(key => (Symbol as any)[key])
        .filter(isSymbol)
)
```  

## set 拦截  

```typescript
const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)
```  

`set` 拦截对象是通过工厂函数 `createSetter` 生成的，它只接受一个参数，是否浅响应  

```typescript
function createSetter( shallow = false ) {
    return function set(
        target: object,
        key: string | symbol,
        value: unknown,
        receiver: object
    ): boolean {
        // 获取旧的值
        const oldValue = (target as any)[key]

        // 默认情况下，如果 setter 的值是一个响应式对象，其实真正设置的是它的原始对象
        // reactive.spec.ts -> 7
        if ( !shallow ) {
            value = toRaw( value )

            // 检测 ref 作为对象的属性值，通过对象.属性名 的方式修改 ref 的值
            // 此时需要通过 ref 的 setter 方法来修改，而不能执行下面的修改逻辑（ 会替换掉原来的 ref ）
            // TODO 为什么需要判断 !isArray( target ) 和 !isRef( value )
            // ref.spec.ts -> 5
            if ( !isArray( target ) && isRef( oldValue ) && !isRef( value ) ) {
                oldValue.value = value
                return true
            }
        } else {
            // in shallow mode, objects are set as-is regardless of reactive or not
        }

        const hadKey = isArray(target) && isIntegerKey(key)
            ? Number(key) < target.length
            : hasOwn(target, key)

        const result = Reflect.set(target, key, value, receiver)
        
        // don't trigger if target is something up in the prototype chain of original
        if (target === toRaw(receiver)) {
            if (!hadKey) {
                trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
                trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
        }

        return result
    }
}
```  

## has 拦截  
`has` 会拦截 `prop in obj` 操作，当触发 `in` 操作时，就会追踪指定的属性  

```typescript
function has(target: object, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    // 只有当查询的不是一个内置 Symbol 才会触发追踪
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
        track(target, TrackOpTypes.HAS, key)
    }
    return result
}
```  

## deleteProperty 拦截  
`deleteProperty` 会拦截 `delete obj[prop]` 操作，就会追踪指定的属性  

```typescript
function deleteProperty(target: object, key: string | symbol): boolean {
    const hadKey = hasOwn( target, key )
    const oldValue = (target as any)[key]
    const result = Reflect.deleteProperty( target, key )
    // 删除的是一个已经存在的属性，才会触发追踪
    if (result && hadKey) {
        trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    return result
}
```  

## ownKeys  拦截  
`ownKeys` 会拦截遍历的操作，当触发下面这些操作时，就会追踪一个遍历的属性 [ITERATE_KEY](#ITERATE_KEY)
1. `Object.getOwnPropertyNames`: 获取对象自身的所有属性，包括不可枚举属性，但不包括 `Symbol` 属性
2. `Object.getOwnPropertySymbols`: 获取对象自身所有的 `Symbol` 属性
3. `Object.keys`: 
4. `for...in`  
5. `JSON.stringify`  

```typescript
function ownKeys(target: object): (string | number | symbol)[] {
    track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
    return Reflect.ownKeys(target)
}
```  

# 示例  

## 数组查找元素  
```typescript
const raw = {}
const arr = reactive([{}, {}, raw])
const observed = arr[2]

expect(arr.indexOf(raw)).toBe(2)
expect(arr.indexOf(observed)).toBe(2)
```  

在 `arr` 中查找 `observed` 也是可以查到的，就是因为在 `arr` 中找不到 `observed`，所以将 `observed` 转换为 `raw` 再去查一遍  

## 修改数组的length禁止追踪  

```typescript
const arr = reactive<number[]>([])
const counterSpy1 = jest.fn(() => arr.push(1)) // push(1)
const counterSpy2 = jest.fn(() => arr.push(2)) // push(2)
effect(counterSpy1);
effect(counterSpy2);

expect(arr.length).toBe(2)
expect(counterSpy1).toHaveBeenCalledTimes(1)
expect(counterSpy2).toHaveBeenCalledTimes(1)
```  

`push` 操作的顺序是：获取数组 length -> 修改 length 为索引的值 -> 更新数组 length  


## 访问 __proto__  

```typescript
const reactiveObj = reactive({})
expect(reactiveObj['__proto__']).toBe(Object.prototype)
```  
