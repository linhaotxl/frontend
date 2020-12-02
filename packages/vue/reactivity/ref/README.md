**为了更加清楚理解源码的意义，代码的顺序做了调整**   

**在代码中会涉及到 `track` 和 `trigger` 两种操作，这两种不会放在本篇中分析，具体可以参考 [track](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#track) 和 [trigger](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#trigger)**  

<!-- TOC -->

- [响应原始值](#响应原始值)
- [ref 类型](#ref-类型)
    - [普通型](#普通型)
        - [ref](#ref)
        - [shallowRef](#shallowref)
        - [createRef](#createref)
        - [RefImpl](#refimpl)
        - [convert](#convert)
    - [自定义型](#自定义型)
        - [customRef](#customref)
        - [CustomRefImpl](#customrefimpl)
    - [对象型](#对象型)
        - [ObjectRefImpl](#objectrefimpl)
- [isRef](#isref)
- [triggerRef](#triggerref)
- [unref](#unref)
- [proxyRefs](#proxyrefs)
    - [shallowUnwrapHandlers](#shallowunwraphandlers)
- [toRefs](#torefs)
    - [toRef](#toref)
- [示例](#示例)
    - [toRefs使用](#torefs使用)

<!-- /TOC -->

# 响应原始值  
`ref` 和 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 类似，都是用来做数据响应化的操作  

通过 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 的介绍我们知道，`reactive` 的参数必须是一个对象，那如果我们要对一个原始数据（ 称为原始值 ）进行响应呢，此时就要用 `ref` 了，但是我们没办法对一个原始值进行监听、代理，所以只能将原始值放进对象里的 `value` 属性，并且拦截 `value`，从而达到代理，这就是 `ref` 的作用  

其实 `ref` 的参数也可以是对象，只不过处理方法有所不同  
1. 参数为原始值: 直接通过 `.value` 获取、设置到原始值  
2. 参数为对象: 会将对象进行 `reactive` 响应化，再通过 `.value` 获取，此时获取的就是响应对象  

# ref 类型  

## 普通型  
普通型 `ref` 总共有两种类型，一个是浅响应，一个是非浅响应  

### ref  
生成普通 `ref` 响应对象  

```typescript
export function ref(value?: unknown) {
	return createRef(value)
}
```  

### shallowRef  
生成浅响应 `ref` 响应对象  

```typescript
export function shallowRef(value?: unknown) {
	return createRef(value, true)
}
```  

### createRef  
这个创建 `ref` 的工厂函数  

```typescript
function createRef(rawValue: unknown, shallow = false) {
	// 如果已经是 ref 对象，则不再对其响应，直接返回
	if (isRef(rawValue)) {
		return rawValue
	}
	return new RefImpl(rawValue, shallow)
}
```  

### RefImpl  
这个 `class` 是 `ref` 类的实现  

```typescript
class RefImpl<T> {
    private _value: T

    public readonly __v_isRef = true

    constructor(private _rawValue: T, private readonly _shallow = false) {
		this._value = _shallow ? _rawValue : convert(_rawValue)
    }

	// value getter
    get value() {
		// 获取 value 时，追踪 ref 的 value 属性
		track(toRaw(this), TrackOpTypes.GET, 'value')
		return this._value
    }

	// value setter
    set value(newVal) {
		// 修改 value 时，如果修改的值发生了变化，则触发追踪 ref value 的依赖
		if (hasChanged(toRaw(newVal), this._rawValue)) {
			this._rawValue = newVal									// 更新原始值
			this._value = this._shallow ? newVal : convert(newVal)	// 更新转换后的值
			trigger(toRaw(this), TriggerOpTypes.SET, 'value', newVal)
		}
    }
}
```  

可以看到，`RefImpl` 的实例中共有以下几个属性  
1. `__v_isRef`：标识这是一个 `ref` 对象  
2. `_rawValue`：原始值  
3. `_value`：转换后的值，如果监听的是一个对象的话，那么需要对原始值进行转换  
4. `_shallow`：是否浅响应  

**注意：如果是浅响应的话，是不会再对原始值进行转换的，只需监听 value 的变化即可**  

### convert  
如果 `val` 是一个对象，则将其转换为 [reactive](#reactive) 响应对象  

```typescript
const convert = <T extends unknown>(val: T): T => isObject(val) ? reactive(val) : val
```  

## 自定义型  
自定义型的 `ref` 可以自己定义 `getter` 和 `setter` 的操作  

### customRef  
这是自定义型 ref 的工厂函数，其中参数 `factory` 是一个函数，接受两个参数，追踪依赖操作、触发依赖操作，并且要返回一个对象，包含 `get` 和 `set` 属性，这两个属性最终就是 `ref.value` 的 `getter` 和 `setter`  

```typescript
export type CustomRefFactory<T> = (
	track: () => void,
	trigger: () => void
) => {
	get: () => T
	set: (value: T) => void
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
	return new CustomRefImpl(factory) as any
}
```  

### CustomRefImpl  

```typescript
class CustomRefImpl<T> {
	private readonly _get: ReturnType<CustomRefFactory<T>>['get']
	private readonly _set: ReturnType<CustomRefFactory<T>>['set']

	public readonly __v_isRef = true

	constructor(factory: CustomRefFactory<T>) {
		// 调用 factory，并传递两个函数作为参数
		const { get, set } = factory(
			() => track(this, TrackOpTypes.GET, 'value'),		// 第一个参数追踪依赖
			() => trigger(this, TriggerOpTypes.SET, 'value')	// 第二个参数触发依赖
		)
		// 记录 get 和 set 操作
		this._get = get
		this._set = set
	}

	get value() {
		return this._get()
	}

	set value(newVal) {
		this._set(newVal)
	}
}
```  

## 对象型  

### ObjectRefImpl  
这是一个对象型的 `ref`，这个 `ref` 会持有对象的引用，这样，通过 `.value` 操作 `ref`，实际上就是在操作原对象，主要用在 [toRef](#toRef) 中  

```typescript
class ObjectRefImpl<T extends object, K extends keyof T> {
	public readonly __v_isRef = true

	constructor(private readonly _object: T, private readonly _key: K) {}

	get value() {
		return this._object[this._key]
	}

	set value(newVal) {
		this._object[this._key] = newVal
	}
}
```  

# isRef  
这个方法用来检测一个对象是否是 `ref` 对象，每个 `ref` 对象都会有一个标识 `__v_isRef`，所以只要判断这个标识就行  

```typescript
export function isRef(r: any): r is Ref {
	return Boolean(r && r.__v_isRef === true)
}
```

# triggerRef   
这个函数用来主动触发 `value` 追踪的依赖，而不是通过修改 `value` 触发的  

```typescript
export function triggerRef(ref: Ref) {
	trigger(ref, TriggerOpTypes.SET, 'value', __DEV__ ? ref.value : void 0)
}
```  

# unref  
这个方法用来解绑 `ref` 对象，也就是直接获取原始值   

```typescript
export function unref<T>(ref: T): T extends Ref<infer V> ? V : T {
	return isRef(ref) ? (ref.value as any) : ref
}
```  

**注意，这里通过 `value` 直接获取原始值，所以可能会触发追踪 `value` 属性的操作**  

# proxyRefs  
这个函数对普通对象做了代理，并且会处理其中的 `ref` 属性，如果访问的值是 `ref` 对象，则直接会*解绑*，即直接获取到原始值；

```typescript
export function proxyRefs<T extends object>(objectWithRefs: T): ShallowUnwrapRef<T> {
	return isReactive(objectWithRefs)
		? objectWithRefs
		: new Proxy(objectWithRefs, shallowUnwrapHandlers)
}
```  

## shallowUnwrapHandlers  

```typescript
const shallowUnwrapHandlers: ProxyHandler<any> = {
	// get 拦截，将对应的属性值使用 unref 解绑，获取 ref 的原始值
	get: (target, key, receiver) => unref(Reflect.get(target, key, receiver)),
	// set 拦截
	set: (target, key, value, receiver) => {
		const oldValue = target[key]
		if (isRef(oldValue) && !isRef(value)) {
			// 旧值是 ref，新值不是 ref
			// 直接会修改 ref 的 value，通过 ref 触发收集的依赖
			oldValue.value = value
			return true
		} else {
			// 直接修改属性值
			return Reflect.set(target, key, value, receiver)
		}
	}
}
```  

# toRefs  
这个函数会将对象里的每个属性值转换为一个 `ref` 对象，这个 `ref` 对象持有原始对象的引用，所以无论修改原始对象还是产物 `ref` 对象，都是同一个地址，最终返回一个同名属性的对象，使用可以参考 [示例](#toRefs使用)  

```typescript
export function toRefs<T extends object>(object: T): ToRefs<T> {
	// 参数必须是响应对象
	if (__DEV__ && !isProxy(object)) {
		console.warn(`toRefs() expects a reactive object but received a plain one.`)
	}
	const ret: any = isArray(object) ? new Array(object.length) : {}
	// 遍历参数，调用 toRef 为每个 key 生成产物
	for (const key in object) {
		ret[key] = toRef(object, key)
	}
	return ret
}
```  


## toRef
这个函数会将对象中的指定属性，转换为一个 `ref` 对象，该 `ref` 对象持有原对象的引用，通过 `.value` 读取、访问，实际都是对原对象的操作  

```typescript
export function toRef<T extends object, K extends keyof T>(object: T, key: K): Ref<T[K]> {
	// 如果值本身就是一个 ref 对象，那么不用再做处理，否则生成一个 ObjectRefImpl 实例
	return isRef(object[key])
		? object[key]
		: (new ObjectRefImpl(object, key) as any)
}
```  

# 示例  
## toRefs使用  

例如有以下组件  

```vue
<template>
	<div>
		<p>{{ info.name }}</p>
		<p>{{ info.age }}</p>

		<button @click="info.name = 'IconMan'">修改名称</button>
		<button @click="info.age = 20">修改名称</button>
	</div>
</template>

<script>
import { reactive } from 'vue';

export default {
	setup () {
		const info = reactive({
			name: 'Nicholas',
			age: 18
		});

		return { info };
	}
}
</script>
```  

现在访问、修改姓名、年龄都要通过 `info` 来访问，如果可以跳过 `info` 岂不是更快捷，此时可以通过 [toRefs](#toRefs) 将 `info` 中的值都转换为响应式的 `ref` 对象，例如下面这样  

```vue
<template>
  <div>
		<p>{{ name }}</p>
		<p>{{ age }}</p>

		<button @click="name = 'IconMan'">修改名称</button>
		<button @click="age = 20">修改名称</button>
	</div>
</template>

<script>
import { reactive, toRefs } from 'vue';

export default {
	setup () {
		const info = reactive({
			name: 'Nicholas',
			age: 18
		});

		return { ...toRefs(info) };
	}
}
</script>
```  

现在转换的结果就是这样  

```typescript
{
	name: ObjectRefImpl,
	age: ObjectRefImpl,
}
```  

并且这两个 `ref` 中的 `_object` 就指向了 `info`，所以在模板中，通过 `name` 无论是获取还是修改，实际访问到的都是 `info.name`  
