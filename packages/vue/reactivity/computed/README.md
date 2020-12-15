> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [什么是计算属性](#什么是计算属性)
- [计算属性实现](#计算属性实现)
    - [computed](#computed)
    - [ComputedRefImpl](#computedrefimpl)
    - [示例](#示例)
        - [普通用法](#普通用法)
        - [响应用法](#响应用法)
        - [连续调用](#连续调用)
        - [setter 使用](#setter-使用)

<!-- /TOC -->

# 什么是计算属性  
当一个值需要 *依赖* 另一个值时，可以使用计算属性，计算属性存在以下特点  

1. 只有在真正使用的时候，才会进行计算  
2. 会缓存数据，多次使用，只有第一次会发生计算  
3. 只有修改数据之后，才会重新计算  


# 计算属性实现  
计算属性被认为是 [ref](#ref) 的一种类型，所以获取、设置都需要通过 `.value` 属性  

## computed  
这个函数用来创建计算属性，接受一个参数  
参数为对象：包含获取值 `get` 以及设置值 `set`  
参数为函数：默认为获取值 `get`，`set` 为空函数  

```typescript
export function computed<T>(
    getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
    let getter: ComputedGetter<T>
    let setter: ComputedSetter<T>

    if (isFunction( getterOrOptions )) {
        getter = getterOrOptions
        setter = __DEV__
        ? () => {
            console.warn('Write operation failed: computed value is readonly')
            }
        : NOOP
    } else {
        getter = getterOrOptions.get
        setter = getterOrOptions.set
    }

    return new ComputedRefImpl(
        getter,
        setter,
        isFunction(getterOrOptions) || !getterOrOptions.set
    ) as any
}
```  

在实例化 `ComputedRefImpl` 时，传递的第三个参数表示是否只读，只要没有 `set` 就被认为是只读的  

## ComputedRefImpl  
先来介绍实例中的几个属性  

1. `_dirty`：直译为 “脏的”，可以理解为是否需要重新计算  
    修改了依赖的数据，就代表计算属性 “脏” 了，需要重新计算  
2. `_value`：缓存计算的结果  
3. `effect`：内部维护的 `lazy` 模式的 [effect]() 对象  
4. `__v_isRef`：标识这是一个 `ref` 对象

```typescript
class ComputedRefImpl<T> {
    private _value!: T
    private _dirty = true

    public readonly effect: ReactiveEffect<T>

    public readonly __v_isRef = true;
    public readonly [ReactiveFlags.IS_READONLY]: boolean

    constructor(
        getter: ComputedGetter<T>,
        private readonly _setter: ComputedSetter<T>,
        isReadonly: boolean
    ) {
        // ①
        this.effect = effect(getter, {
            lazy: true,
            scheduler: () => {
                // 当值发生改变的时候，并不会去直接触发副作用函数 getter，而是会等到下次获取值的时候再调用 getter
                if (!this._dirty) {
                    this._dirty = true
                    trigger(toRaw(this), TriggerOpTypes.SET, 'value')
                }
            }
        })

        this[ReactiveFlags.IS_READONLY] = isReadonly
    }

    // ②
    get value() {
        // 如果数据是脏的(发生了改变)，则调用 effect 开启追踪，再调用 getter 获取新的值，并追踪
        // 当值发生变化的时候，就会触发 effect 的调度器
        if (this._dirty) {
            this._value = this.effect()
            this._dirty = false
        }
        // 追踪 value
        track(toRaw(this), TrackOpTypes.GET, 'value')
        return this._value
    }

    // ③
    set value(newValue: T) {
        // 调用传递进来的 setter
        this._setter(newValue)
    }
}
```  

首先看 ① 处生成的 `effect` 对象  
1. 它的原始函数就是需要计算的逻辑，通过 `computed` 传递  
2. 存在调度器，调度器里仅仅触发了追踪实例的 `effect`  
    注意，如果不需要重新计算才会触发，接着立即将 `_dirty` 设置为 `true` 表示需要重新计算，这里是唯一修改为需要重新计算的入口  
    也就是说，只有触发了调度器，才会重新计算，那什么时候会触发调度器，肯定就是 `this.effect` 的 `getter` 里追踪了某个响应对象，当响应对象发生变化的时候，就会触发  

再看 ② 处的 `value`  
这里会调用 `effect` 函数，开启追踪，并执行原始函数 `getter`，在 `getter` 里，可能会访问响应对象，使得 `this.effect` 追踪响应对象  
在获取到计算值后，立即将 `_dirty` 设置为 `false`，表示不再需要重新计算了  
之后再追踪当前实例对象  

`_dirty` 的默认值是 `true`，所以第一次获取值时是会重新计算的  

接下来先看示例  

## 示例  
### 普通用法  
```typescript
const value = reactive<{ foo?: number }>({})
const getter = jest.fn(() => {
    return value.foo;
})
const cValue = computed(getter)

// getter 不会执行
expect(getter).not.toHaveBeenCalled()

// 调用 this.effect，再调用 getter 重新计算值，使得 this.effect 追踪了 value 的 foo
expect(cValue.value).toBe(undefined)
expect(getter).toHaveBeenCalledTimes(1)

// 再次获取值时，由于依赖的响应数据并没有发生变化，所以不会重新计算
cValue.value
expect(getter).toHaveBeenCalledTimes(1)

// 更新 value 的 foo，触发追踪它的 effect(就是 cValue 生成的 effect)，标识 _dirty 为需要重新计算，触发追踪 cValue 的 effect(这里没有)
value.foo = 1

// set 后并不会重新计算，只有等到下次使用的时候才会重新计算
expect(getter).toHaveBeenCalledTimes(1)

// 获取值，重新计算结果
expect(cValue.value).toBe(1)
expect(getter).toHaveBeenCalledTimes(2)
```  

### 响应用法  
```typescript
const value = reactive<{ foo?: number }>({})
const cValue = computed(() => value.foo)
let dummy

// effect1
effect(() => {
    // effect1 开启追踪
    // cValue 的 effect 开启追踪，调用 getter，追踪 value 的 foo，结束追踪
    // effect1 追踪 cValue 的 value，结束追踪
    dummy = cValue.value
})

expect(dummy).toBe(undefined)

// 更新响应值，触发追踪 value.foo 的 effect(cValue 的 effect)，调用它的调度器，标识需要更新，接着再触发追踪 cValue.value 的 effect(effect1)
// 执行 effect1，再次获取值，重新计算
value.foo = 1

expect(dummy).toBe(1)
```  

### 连续调用  
```typescript
const value = reactive({ foo: 0 })
const getter1 = jest.fn(() => {
    return value.foo;
})
const getter2 = jest.fn(() => {
    return c1.value + 1
})
const c1 = computed(getter1)
const c2 = computed(getter2)

let dummy
// effect1
effect(() => {
    // effect1 开启追踪
    // c1.value 开启追踪，调用原始函数 getter1，追踪 value 的 foo，结束追踪，effect1 追踪 c1.value
    // c2.value 开始追踪，调用原始函数 getter2，调用 c1.value，直接获取不用重新计算，但是会追踪 c1，结束追踪,effect1 追踪 c2.value
    dummy = c1.value + c2.value
})

expect(dummy).toBe(1)
expect(getter1).toHaveBeenCalledTimes(1)
expect(getter2).toHaveBeenCalledTimes(1)

// 触发追踪的 value.foo 的 effect(c1 的 effect)，调用 c1.effect 的调度器，标识 c1 需要重新计算，并触发追踪 c1 的 effect(有两个，effect1 和 c2.effect)
//  执行 effect1 开始追踪：此时 c1 可以重新计算，结果为 1，c2 无法重新计算，结果还是之前的 1，现在 dummy 为 2，结束追踪
//  执行 c2 的调度器，标识 c2 需要重新计算，触发追踪 c2 的 effect(effect1)
//    调用 effect1：开始追踪，此时 c1 无需重新计算，结果还是之前的 1，c2 重新计算，结果为 2，现在 dummy 为 3，结束追踪
value.foo++

expect(dummy).toBe(3)
expect(getter1).toHaveBeenCalledTimes(2)
expect(getter2).toHaveBeenCalledTimes(2)
```  

### setter 使用  
```typescript
const n = ref(1)
const plusOne = computed({
    get: () => n.value + 1,
    set: val => {
        n.value = val - 1
    }
})

// 重新计算，plusOne 的 effect 追踪 n 的 value
expect(plusOne.value).toBe(2)

// 修改 n，触发 plusOne 的 effect 调度器，标识需要重新计算
n.value++

// 重新计算
expect(plusOne.value).toBe(3)

// 触发 plusOne 的 setter，修改 n，触发 plusOne 的 effect 调度器，标识需要重新计算
plusOne.value = 0

// 重新计算
expect(n.value).toBe(-1)
expect(plusOne.value).toBe(0);
```  
