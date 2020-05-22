**为了更加清楚理解源码的意义，代码的顺序做了调整**  

之前说过的 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 和 [ref](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/ref) 都是作响应式的，那具体响应式是如何做到的，就在于 `get` 中的 `track` 以及 `set` 中的 `trigger`  

这两种操作是相互依赖的，类似于 “订阅-发布”，其中 `track` 用来收集依赖，而 `trigger` 用来触发依赖  

依赖可以理解为，期望某个数据发生变化时，能做一些额外的处理，例如  

```typescript
let count;
let name
const observal = reactive({ count: 0, name: 'IconMan' });
const effect1 = effect(() => {
  count = observal.count;
  name = observal.name;
});

observal.count = 2;
dummy === 2;  // true
```  

这段代码的意思是，回调依赖了 `count` 和 `name` 属性，只有两个任意一个发生变化时，就会执行回调  

# 前置点  

## targetMap  
这个变量用来收集所有的依赖，它的结构大致是这样  

```typescript
targetMap -> {
    原始对象 -> {
        属性1 -> [ 依赖1, 依赖2 ],
        属性2 -> [ 依赖3, 依赖4 ]
    }
}
```  

其中，`-> {}` 表示它是一个 `Map` 实例而不是普通对象，`-> []` 是一个 `Set` 实例而不是数组   

`targetMap` 初始化为   

```typescript
type Dep = Set<ReactiveEffect>                    // 依赖集合
type KeyToDepMap = Map<any, Dep>                  // 属性依赖的 Map
const targetMap = new WeakMap<any, KeyToDepMap>()
```  

对于上面示例来说，此时 `targetMap` 长这样  

```typescript
targetMap -> {
  { count: 0, name: 'IconMan' } -> {
    count -> [ effect1 ],
    name -> [ effect1 ]
  }
}
```

## shouldTrack 和 trackStack  
这两个变量主要用来控制追踪的开启与暂停，`shouldTrack` 表示当前开启与关闭的状态，`trackStack` 表示上一次状态  

### enableTracking  
这个函数用来开启追踪状态  

```typescript
function enableTracking() {
  // 将上次的状态存储并修改本次的状态为 true
  trackStack.push( shouldTrack )
  shouldTrack = true
}
```  

### pauseTracking  
这个函数用来关闭追踪状态  

```typescript
function pauseTracking() {
  // 将上次的状态存储并修改本次的状态为 false
  trackStack.push( shouldTrack )
  shouldTrack = false
}
```  

### resetTracking  
这个函数用来恢复至上一次的状态  

```typescript
function resetTracking() {
  // 取出上一次的状态，并更新到本次的状态
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}
```

# effect  
`effect` 函数就是用来产生依赖的 “额外处理”  
1. 回调，也就是具体的 “额外处理” 的内容  
2. 配置对象  

`effect` 函数最后会返回一个 `effect` 对象，这个 `effect` 对象也是一个函数，但它并不是我们传的第一个参数，而是将其包装了一层，先来看看 `effect` 对象的结构  

```typescript
interface ReactiveEffect<T = any> {
    (...args: any[]): T
    _isEffect: true                 // 标识是否是 effect 对象
    id: number                      // 唯一标识
    active: boolean         
    raw: () => T                    // effect 对象的原始函数，即传递的第一个参数
    deps: Array<Dep>                // 所有依赖的集合
    options: ReactiveEffectOptions  // effect 对象的配置，即传递的第二个参数
}
```  

再来看配置对象都有哪些选项  

```typescript
export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}
```  

接下来看 `effect` 的实现  

```typescript
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = {}
): ReactiveEffect<T> {
  // 如果监测的回调是 effect，那么实际监测的原始函数是同一个 fn
  if ( isEffect( fn ) ) {
    fn = fn.raw
  }
  // 创建 effect 对象
  const effect = createReactiveEffect( fn, options )

  // 根据配置对象，决定是否先执行一次
  if ( !options.lazy ) {
    effect()
  }

  return effect
}
```  

## createReactiveEffect  
这个方法用来创建一个 `effect` 对象，接受两个参数，即 “原始函数” 和 “配置对象”  

```typescript
function createReactiveEffect<T = any>(
  fn: (...args: any[]) => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // 创建 effect 对象，也是一个函数
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    // ①
    // 检测当前 effect 是否已经被 stop
    // 对于停止的 effect，如果存在 scheduler 那么什么都不会做；否则会调用原始函数
    if ( !effect.active ) {
      return options.scheduler ? undefined : fn( ...args )
    }

    // ②
    if ( !effectStack.includes( effect ) ) {
      // ③
      // 清除所有的追踪，fn 可能存在逻辑判断，所以需要重新计算追踪的属性
      cleanup( effect )
      try {
        enableTracking()
        // ④
        effectStack.push(effect)
        activeEffect = effect
        // ⑥
        return fn(...args)
      } finally {
        // ⑤
        effectStack.pop()
        resetTracking()
        // ⑦
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  
  // 设置 effect 对象的一些属性，和上面说的 ReactiveEffect 结构对应
  effect.id = uid++
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options

  return effect
}
```  

### 用到的全局变量  

#### effectStack  
这个变量是一个数组，每执行一个 `effect` 对象，就会 `push` 进去，直到回调执行完成后再 `pop` 出来  

#### activeEffect  
这个变量保存的是当前正在执行的 `effect` 对象，在后面的 `track` 中会用到

## cleanup  

## track  

## trigger