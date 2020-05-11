**为了更加清楚理解源码的意义，代码的顺序做了调整**  

# Reactive  
reactive 也就是响应式对象，在这个版本中是通过 `ES6` 的 `Proxy` 来实现的，我们代理后的对象称为响应对象，代理前的对象称为原始对象，如下  
```javascript
const 响应对象 = new Proxy( 原始对象, { /**/ } );
```  

## 原始对象和响应对象映射关系  
在源码中，定义了几个变量，用来存储 原始对象 和 响应对象 的关系，它们都是 `Map` 的实例，所以 `key` 都是对象类型  

```typescript
const rawToReactive = new WeakMap<any, any>() // 原始对象 -> 响应对象
const reactiveToRaw = new WeakMap<any, any>() // 响应对象 -> 原始对象
const rawToReadonly = new WeakMap<any, any>() // 只读原始对象 -> 只读响应对象
const readonlyToRaw = new WeakMap<any, any>() // 只读响应对象 -> 只读原始对象
```  

由这几个变量会引申出几个方法，先来看这个实例  
```javascript
const original = { name: 'IconMan' };
const observal = reactive( original );
```  

先不看 `reactive` 方法具体做了什么，总之在执行完成后，`rawToReactive` 会是下面这样  
```javascript
Map {
    original -> observal
}
```  
而 `reactiveToRaw` 则是这样  
```javascript
Map {
    observal -> original
}
```   

### isReactive  
这个方法用来检测一个对象是否是响应对象，根据前面的变量大概可以猜出它的实现方式就是调用 `reactiveToRaw.has` 方法来检测是否含有指定值  

```typescript
function isReactive( value: unknown ): boolean {
  value = readonlyToRaw.get( value ) || value
  return reactiveToRaw.has( value );
}
```  

但为什么会先从 `readonlyToRaw` 获取一次呢？先看下面这个示例  
```javascript
const a = { n: 1 };
const b = reactive( a );
const c = readonly( b );
isReactive( c );  // true
```  

上面代码执行完成后，映射关系如下  
```javascript
rawToReactive: Map { a -> b }
reactiveToRaw: Map { b -> a }
rawToReadonly: Map { b -> c }
readonlyToRaw: Map { c -> b }
```  

当 `readonly` 一个响应对象时候，那么返回的这个对象（ 示例中的 `c` ）也应该是一个响应对象
所以源码中需要先从 `readonlyToRaw` 中取出对应的原始对象（ 该原始对象会是一个响应式对象 ），然后再从 `reactiveToRaw` 中检查是否存在

### isReadonly  
这个方法就是用来检测一个对象是否是只读响应对象，它的实现就是单纯的调用 `readonlyToRaw.has`  

```typescript
function isReadonly( value: unknown ): boolean {
  return readonlyToRaw.has( value )
}
```  

### toRaw  
这个方法会获取响应对象的原始对象，如果不是响应对象那么就会返回自身  

```typescript
function toRaw<T>(observed: T): T {
  observed = readonlyToRaw.get( observed ) || observed
  // 从 reactiveToRaw 中获取原始对象，如果没有则返回 observed 自身
  return reactiveToRaw.get( observed ) || observed
}
```  

为什么会先从 `readonlyToRaw` 获取一次？基于上面的示例  
```typescript
toRaw( b ) === toRaw( c );  // true
```  
原理和 `isReactive` 相似，还是会先从 `readonlyToRaw` 中取出对应的响应对象（ 示例中的 `b` ），再从 `reactiveToRaw` 获得最终的原始对象  

## 标记为原始对象  
通常，普通的对象是可以进行响应式的，但是我们可以通过 `markRaw` 方法，将某个对象标记为原始类型，那么这个对象就无法再背响应式了，即 `reactive` 的返回值就是这个对象  

```typescript
// 保存标记对象的集合
const rawValues = new WeakSet<any>()
function markRaw<T extends object>( value: T ): T {
  rawValues.add( value )
  return value
}
```  
可以看到，只要在 `rawValues` 集合中的对象都被认为被标记的对象