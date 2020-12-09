**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [响应对象](#响应对象)
    - [ReactiveFlags](#reactiveflags)
    - [原始对象和响应对象映射关系](#原始对象和响应对象映射关系)
- [createReactiveObject](#createreactiveobject)
    - [getTargetType](#gettargettype)
    - [targetTypeMap](#targettypemap)
    - [isReadonly](#isreadonly)
    - [isReactive](#isreactive)
    - [toRaw](#toraw)
    - [markRaw](#markraw)
- [各种类型的响应对象](#各种类型的响应对象)
    - [reactive](#reactive)
    - [shallowReactive](#shallowreactive)
    - [readonly](#readonly)
    - [shallowReadonly](#shallowreadonly)

<!-- /TOC -->

# 响应对象  
reactive 也就是响应式对象，在这个版本中是通过 `ES6` 的 `Proxy` 来实现的，我们称代理后的对象为响应对象，代理前的对象称为原始对象，如下  
```typescript
const 响应对象 = new Proxy( 原始对象, 拦截对象 );
```  

## ReactiveFlags
```typescript
export const enum ReactiveFlags {
	SKIP = '__v_skip',
	IS_REACTIVE = '__v_isReactive',
	IS_READONLY = '__v_isReadonly',
	RAW = '__v_raw'
}
```  

## 原始对象和响应对象映射关系  
在源码中，定义了两个 `Map` 对象，用来存储 *原始对象* 和 *响应对象* 间的关系，下面称为 **映射关系对象**   

```typescript
export interface Target {
    [ReactiveFlags.SKIP]?: boolean
    [ReactiveFlags.IS_REACTIVE]?: boolean
    [ReactiveFlags.IS_READONLY]?: boolean
    [ReactiveFlags.RAW]?: any
}

const reactiveMap = new WeakMap<Target, any>()	// 普通原始对象 -> 响应对象
const readonlyMap = new WeakMap<Target, any>()	// 只读原始对象 -> 响应对象
```  

# createReactiveObject  
这个方法是专门用来创建响应对象的，并返回响应对象；其中第四、五个参数为具体的拦截对象，即 `new Proxy` 的第二个参数，由于集合类型的拦截对象和非集合不一样，所以会有两个参数，具体用哪一个取决于原始对象的类型  

```typescript
function createReactiveObject(
	target: Target,							// 原始对象
	isReadonly: boolean,					// 是否只读
	baseHandlers: ProxyHandler<any>,		// 普通拦截对象
	collectionHandlers: ProxyHandler<any>	// 集合拦截对象
) {
	// 检测如果不是对象，直接返回，抛出警告 
	if (!isObject(target)) {
		if (__DEV__) {
			console.warn(`value cannot be made reactive: ${String(target)}`)
		}
		return target
	}
	
	// target is already a Proxy, return it.
	// exception: calling readonly() on a reactive object
	if (
		target[ReactiveFlags.RAW] &&
		!(isReadonly && target[ReactiveFlags.IS_REACTIVE])
	) {
		return target
	}

	// 根据是否只读，来获取映射关系对象
	const proxyMap = isReadonly ? readonlyMap : reactiveMap
	// 如果映射关系中已经存在原始对象，则直接返回目标对象；即对同一个对象多次响应化，也只会有一个响应对象
	const existingProxy = proxyMap.get(target)
	if (existingProxy) {
		return existingProxy
	}
	
	// 获取目标对象的类型，只有在白名单中的类型才会响应，否则直接返回原始对象
	const targetType = getTargetType(target)
	if (targetType === TargetType.INVALID) {
		return target
	}

	// 创建目标的代理，拦截对象为根据是否是集合来决定
	const proxy = new Proxy(
		target,
		targetType === TargetType.COLLECTION
			? collectionHandlers  // 集合使用参数 collectionHandlers
			: baseHandlers        // 非集合使用参数 baseHandlers
	)

	// 在关系映射中设置 原始对象 -> 响应对象
	proxyMap.set(target, proxy)

	// 返回响应对象
	return proxy
}
```  

这个方法的实现不算太复杂，主要就是为 `target` 设置了代理，并根据数据类型设置不同的拦截，复杂的是拦截对象，后面会讲到  
如果对象的数据类型无效，则不会对其进行响应化  

## getTargetType  
这个函数用来获取值的数据类型，两种情况表示这是一个无效的数据类型  
1. 不需要响应化，即带有 `ReactiveFlags.SKIP`  
2. 这是一个不可扩展的对象  

```typescript
function getTargetType(value: Target) {
	return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
		? TargetType.INVALID
		: targetTypeMap(toRawType(value))
}

```  

## targetTypeMap  
这个函数会根据数据类型，来获取是集合类型还是非集合类型  

```typescript
const enum TargetType {
	INVALID = 0,	// 无效
	COMMON = 1,		// 非集合
	COLLECTION = 2	// 集合
}

function targetTypeMap(rawType: string) {
	switch (rawType) {
		case 'Object':
		case 'Array':
			return TargetType.COMMON
		case 'Map':
		case 'Set':
		case 'WeakMap':
		case 'WeakSet':
			return TargetType.COLLECTION
		default:
			return TargetType.INVALID
	}
}
```  

**只有 `Map`、`Set`、`WeakMap`、`WeakSet` 这四个才属于集合类型，数组并不属于**  

## isReadonly  
这个方法就是用来检测一个对象是否是只读响应对象，只要带有 `ReactiveFlags.IS_READONLY` 标识的就是只读的  

```typescript
export function isReadonly(value: unknown): boolean {
	return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}
```  

## isReactive  
这个方法用来检测一个对象是否是响应对象  

```typescript
export function isReactive(value: unknown): boolean {
	if (isReadonly(value)) {
		return isReactive((value as Target)[ReactiveFlags.RAW])
	}
	return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}
```  

<!-- 只要存在于 `reactiveToRaw` 集合中的对象都被认为是响应对象，所以，`readonly` 生成的对象并不属于响应式，但为什么会先从 `readonlyToRaw` 获取一次呢？先看下面这个示例  
```typescript
const a = { n: 1 };
const b = reactive( a );
const c = readonly( b );
isReactive( c );  // true
```  

上面代码执行完成后，映射关系如下  
```typescript
rawToReactive: Map { a -> b }
reactiveToRaw: Map { b -> a }
rawToReadonly: Map { b -> c }
readonlyToRaw: Map { c -> b }
```  

当 `readonly` 的参数是一个响应对象时候，那么返回的这个 “只读响应对象”（ 示例中的 `c` ）也应该被检测为响可响应的，因为它只是把原始的响应对象变为只读的了  

所以这一步的目的就在于处理这种情况（ 参数是一个经过 `readonly` 的普通响应对象 ），会先获取它的原始对象（ 这个原始对象会是一个普通的响应对象 ），然后实际检测的是这个普通的响应对象 -->

## toRaw  
这个方法会获取 *响应对象* 的 *原始对象*，如果不是就会返回参数自身  

```typescript
export function toRaw<T>(observed: T): T {
	return (
		(observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
	)
}
```  

可以看到，获取 *原始对象* 其实就是获取 `ReactiveFlags.RAW` 的值，这个值最终会被拦截对象所拦截，这里针对两种情况一个一个看  

1. [非集合拦截参考](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/baseHandlers/README.md#get-%E6%8B%A6%E6%88%AA)  
2. [集合拦截参考](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/baseHandlers/README.md#get-%E6%8B%A6%E6%88%AA)

可以看到，`ReactiveFlags.RAW` 最终返回的是原始对象 `target`，然后又对返回值调用 `toRaw` 方法，再次获取 `ReactiveFlags.RAW` 的值，一直重复这个过程，直至结果不再是一个响应对象，那么这个值也就是最终的 *原始对象*  

**`toRaw` 会递归获取原始对象**  

假如现在有以下代码  

```typescript
const original = {};
const observal = reactive(original);
const observalR = readonly(observal);

expect(toRaw(observalR)).toBe(original);
```  

转换过程为  
1. 获取 `observalR` 的 `[ReactiveFlags.RAW]`，得到 `observal`，再对 `observal` 进行 `toRaw` 操作  
2. 获取 `observal` 的 `[ReactiveFlags.RAW]`，得到 `original`，再对 `observal` 进行 `toRaw` 操作  
3. 获取 `original` 的 `[ReactiveFlags.RAW]`，得到 `undefined`，返回 `undefined`    
4. 第二步中得到的是 `undefined`，所以返回 `original`，同理第一步  

那如果就是想获取 `observalR` 的原始对象 `observal` 呢，可以直接访问 `[ReactiveFlags.RAW]` 得到  

## markRaw  
通常，普通的对象是可以进行响应化的，但是我们可以通过这个方法，将某个对象标记为原始类型，即这个对象就无法再被响应化了  
源码中实现的也很简单，就是添加了 `ReactiveFlags.SKIP` 标记  

```typescript
export function markRaw<T extends object>(value: T): T {
	def(value, ReactiveFlags.SKIP, true)
	return value
}
```  

# 各种类型的响应对象
## reactive  
这个方法接受一个原始对象作为参数，会生成一个普通的响应对象  

```typescript
export function reactive(target: object) {
	// 如果 target 本身就是一个 只读响应对象，则不会再对其进行响应，直接返回 只读响应对象
	if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
		return target
	}

	return createReactiveObject(
		target,
		false,
		mutableHandlers,
		mutableCollectionHandlers
	)
}
```  

注意：普通响应对象，它的拦截对象是 `mutableHandlers` 或者 `mutableCollectionHandlers`  

## shallowReactive  
shallow 的意思就是 “浅”，`shallowReactive` 的意思就是浅响应式，即属性值如果还是对象的话，则不会对其再进行响应化，例如：  

```typescript
const original = {
    info: {
        name: 'IconMan'
    }
}
const observal1 = reactive( original );
const observal2 = shallowReactive( original );
```  

此时，`observal1.info` 得到的还是一个响应对象，而 `observal2.info` 得到的就是原始对象本身  

它的实现和 [reactive](#reactive) 不同之处就在于拦截对象不同，`shallowReactive` 采用 `shallowReactiveHandlers` 或者 `shallowCollectionHandlers` 作拦截对象  

```typescript
export function shallowReactive<T extends object>(target: T): T {
	return createReactiveObject(
		target,
		false,
		shallowReactiveHandlers,
		shallowCollectionHandlers
	)
}
```

## readonly   
```typescript
export function readonly<T extends object>(target: T): DeepReadonly<UnwrapNestedRefs<T>> {
	return createReactiveObject(
		target,
		true,
		readonlyHandlers,
		readonlyCollectionHandlers
	)
}
```   

## shallowReadonly  
这个方法生成的只读响应对象，也是不可嵌套的，实现也比较简单，采用的是 `shallowReadonlyHandlers` 代理  

```typescript
export function shallowReadonly<T extends object>(target: T): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}
```  