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
    - [设置原始值](#设置原始值)
    - [对象内设置ref的值](#对象内设置ref的值)
    - [ref自动解包](#ref自动解包)
    - [target和receiver](#target和receiver)

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
        // ① 检测属性来源，主要用于 isReactive、isReadonly 中
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

        // 只会追踪 非只读响应对象
        if (!isReadonly) {
            track(target, TrackOpTypes.GET, key)
        }

        // 如果是浅响应，直接返回获取到的 res
        if (shallow) {
            return res
        }

        // 如果获取到的结果是 ref 对象，那么会根据情况进行 “解包”，即直接返回 ref.value
        if (isRef(res)) {
            // ② 解包需要满足以下条件
            // 1. 在非数组中获取到的是 ref 对象
            // 2. 在数组中访问的属性不是索引
            const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
            return shouldUnwrap ? res.value : res
        }

        // 如果 res 是个对象，则再根据是否只读对其进行响应化，并返回响应对象
        if (isObject(res)) {
            return isReadonly ? readonly(res) : reactive(res)
        }

        // 返回 res，此时不是对象、也不是 ref
        return res
    }
}
```  

1. 在 [isReadonly](#isReadonly)、[isReactive](#isReactive) 中都会访问 `IS_READONLY`、`IS_REACTIVE` 属性，此时就会被拦截，而结果就取决于闭包参数中的 `isReadonly`，只要不是只读，就是响应式的  
2. 在 ② 处，会自动将 `ref` 进行 “解包” 操作，参考 [示例](#ref自动解包)  

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

        if ( !shallow ) {
            // ①
            value = toRaw( value )

            // ②
            if ( !isArray( target ) && isRef( oldValue ) && !isRef( value ) ) {
                oldValue.value = value
                return true
            }
        } else {
            // in shallow mode, objects are set as-is regardless of reactive or not
        }

        // 检测设置的 key 是否存在（是新增还是更新）
        const hadKey = isArray(target) && isIntegerKey(key)
            ? Number(key) < target.length
            : hasOwn(target, key)

        const result = Reflect.set(target, key, value, receiver)
        
        // ③
        if (target === toRaw(receiver)) {
            if (!hadKey) {
                // 触发新增 key 的依赖
                trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
                // 更新的值发生变化，触发更新 key 的依赖
                trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
        }

        return result
    }
}
```  

1. 在 ① 处，`value` 有可能是一个响应对象，会将其转换为原始对象，在之后设置的时候，实际设置的都是原始值而非响应值，可以参考 [示例](#设置原始值)  
2. 在 ② 处，如果在一个对象内，给一个 `ref` 属性设置值，实际会通过 `ref` 对象的代理，而不是通过 `setter` 来实现，可以参考 [示例](#对象内设置ref的值)  
3. 在 ③ 处，只有调用者对象和被修改的对象 是同一个响应对象，那么才会成功触发追踪的依赖，可以参考 [示例](#target和receiver)  

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

## 设置原始值  
```typescript
const obj1 = {}
const obj2 = {}
const arr = reactive([obj1, obj2])

let index: number = -1
effect(() => {
    index = arr.indexOf(obj1)
})
expect(index).toBe(0)
arr.reverse()
expect(index).toBe(1)
```  

在 `indexOf` 函数中，会对每个索引进行追踪，而在接下来的 `reverse` 函数中，会分别获取每个索引的值，**注意这里获取到的每个值都是响应对象**，然后会将索引 `1` 的值赋值给索引 `0`，索引 `0` 的值负赋值给索引 `1`，从而触发 `setter`  
在 `setter` 中会将值(这里是响应对象)转换为原始对象，所以设置的其实还是 `obj1` 和 `obj2`，而非它们的响应对象，如果不做这一步，那么设置的就是 `obj1` 和 `obj2` 的响应对象了，最后的 `index` 就是 `-1` 了  

```typescript
const original: any = { foo: 1 }
const original2 = { bar: 2 }
const observed = reactive(original)
const observed2 = reactive(original2)
observed.bar = observed2
expect(observed.bar).toBe(observed2)
expect(original.bar).toBe(original2)
```  

## 对象内设置ref的值   
```typescript
const a = ref(1)
const b = { c: a }
const obj = reactive({
    a,
    b
})

effect(() => {
    dummy1 = obj.a
    dummy2 = obj.b.c 
});

a.value++;
obj.b.c++;
```  

首先在 `effect` 内部会追踪 `obj` 的 `a` 和 `b`，`b` 的 `c`，以及 `a.value` 这几个属性  
通过 `a.value++` 修改，会被 `ref` 的 `setter` 拦截，从而触发依赖  
通过 `obj.b.c++` 修改，会进入 `reactive` 的 `setter`，此时原始对象 `b` 不是数组，且旧值 `c` 是一个 `ref` 对象，新值 `2` 不是一个 `ref` 对象，所以会进入 ② 的逻辑，其实这就是修改对象中的 `ref` 的值，所以应该有 `ref` 的 `setter` 来处理 

## ref自动解包  

```typescript
const a = { b: ref(0) };
const c = ref(a)

// 原始对象为普通对象，发生自动解包
expect(c.value.b).toBe(0);
```  

```typescript
const arr = ref([1, ref(3)]).value
expect(isRef(arr[0])).toBe(false)
// 原始对象为数组，且访问的是索引，不会发生自动解包
expect(isRef(arr[1])).toBe(true)
expect((arr[1] as Ref).value).toBe(3)
```  

```typescript
const arr = [ref(0)]
const symbolKey = Symbol('')
arr['' as any] = ref(1)
arr[symbolKey as any] = ref(2)

const arrRef = ref(arr).value

// 原始对象为数组，且访问的是索引，不会发生自动解包
expect(isRef(arrRef[0])).toBe(true)

// 原始对象为数组，且访问的不是索引，发生自动解包
expect(isRef(arrRef['' as any])).toBe(false)
expect(isRef(arrRef[symbolKey as any])).toBe(false)
expect(arrRef['' as any]).toBe(1)
expect(arrRef[symbolKey as any]).toBe(2)
```  

## target和receiver  

```typescript
let dummy, parentDummy, hiddenValue: any
const children = reactive<{ prop?: number, type: string; }>({ type: 'children' })
const parent = reactive({
    set prop(value) {
        hiddenValue = value
    },
    get prop() {
        return hiddenValue
    },
    type: 'parent'
})
// children 继承 parent
Object.setPrototypeOf(children, parent)
effect(() => (dummy = children.prop))       // 追踪 children.prop，parent.prop
effect(() => (parentDummy = parent.prop))   // 追踪 parent.prop

expect(dummy).toBe(undefined)
expect(parentDummy).toBe(undefined)

children.prop = 4
expect(dummy).toBe(4)
// this doesn't work, should it?
// expect(parentDummy).toBe(4)
parent.prop = 2
expect(dummy).toBe(2)
expect(parentDummy).toBe(2)
```  

在更新 `children.prop = 4` 时，由于是 `children` 触发的 `setter`，所以 `receiver` 就是 `children`  
由于 `children` 没有 `prop` 而 `parent` 存在 `prop` 的读取操作，所以当触发更新操作 `Reflect.set(target, key, value, receiver)` 时，会进入到 `parent` 的 `setter`  
 * 而此时 `target` 是 `parent`，和 `receiver` 不相同，所以更新成功后不会触发依赖  

回到 `children` 的 `setter` 中，更新完成后触发 `children` 的依赖，修改 `dummy`，而 `parentDummy` 不变  

**对象自身修改自身的属性，才会触发追踪的依赖**  

