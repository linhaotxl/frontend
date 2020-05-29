**为了更加清楚理解源码的意义，代码的顺序做了调整**  

- [前置知识](#前置知识)
    - [targetMap](#targetmap)
    - [shouldTrack 和 trackStack](#shouldtrack-和-trackstack)
        - [enableTracking](#enabletracking)
        - [pauseTracking](#pausetracking)
        - [resetTracking](#resettracking)
- [effect](#effect)
    - [effect 结构](#effect-结构)
    - [createReactiveEffect](#createreactiveeffect)
    - [effect](#effect-1)
        - [用到的全局变量](#用到的全局变量)
            - [effectStack](#effectstack)
            - [activeEffect](#activeeffect)
    - [track](#track)
    - [cleanup](#cleanup)
    - [trigger](#trigger)

之前说过的 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 和 [ref](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/ref) 都是作响应式的，那具体响应式是如何做到的，就在于 `get` 中的 `track` 以及 `set` 中的 `trigger`  

这两种操作是相互依赖的，类似于 “订阅-发布”，其中 `track` 用来收集依赖，而 `trigger` 用来触发依赖  

依赖可以理解为，期望某个数据发生变化时，所做一些额外的处理，例如  

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

这段代码的意思是，“额外处理” 依赖了 `count` 和 `name` 属性，只要两个任意一个发生变化时，就会执行 

# 前置知识  

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

`targetMap` 初始化为 `Map` 实例   

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

## effect 结构  
通过下面的 [createReactiveEffect](#createReactiveEffect) 函数可以创建一个 `effect` 对象，先来看看它的结构  

```typescript
interface ReactiveEffect<T = any> {
  (...args: any[]): T             // 原始函数
  _isEffect: true                 // 标识是否是 effect 对象
  id: number                      // 唯一标识
  active: boolean                 // 是否处于激活状态
  raw: () => T                    // effect 对象的原始函数
  deps: Array<Dep>                // 所有依赖的集合
  options: ReactiveEffectOptions  // effect 对象的配置
}
```  

再来看配置对象的结构  

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

## createReactiveEffect  
`createReactiveEffect` 函数用来创建一个具体 `effect` 对象，接受两个参数，即 “原始函数” 和 “配置对象”  

共有两个参数  
1. 额外处理的回调
2. 配置选项

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
      // ③ 清除所有的追踪，fn 可能存在逻辑判断，所以需要重新计算追踪的属性
      cleanup( effect )
      try {
        // ④ 开启追踪
        enableTracking()
        // ⑤ effect 入栈
        effectStack.push(effect)
        // ⑥ 设置 activeEffect 为当前 effect
        activeEffect = effect
        // ⑦ 执行 fn 回调
        return fn(...args)
      } finally {
        // ⑧ effect 出栈
        effectStack.pop()
        // ⑨ 恢复追踪
        resetTracking()
        // 🔟 恢复 activeEffect 为栈中的最后一个
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

可以看到，这个方法只是单纯的创建了 `effect` 对象，并设置了一些属性，具体的逻辑在 `effect` 对象中  

## effect  
这个函数就是我们开发中会经常用到的，它只是对 `createReactiveEffect` 做了一层包装，并处理了额外的一些逻辑，所以参数是一样的  

```typescript
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = {}
): ReactiveEffect<T> {
  // ①
  // 如果监测的回调是 effect，那么实际监测的原始函数是同一个 fn
  if ( isEffect( fn ) ) {
    fn = fn.raw
  }
  // 创建 effect 对象
  const effect = createReactiveEffect( fn, options )

  // 根据配置，决定是否懒执行
  if ( !options.lazy ) {
    effect()
  }

  return effect
}
```    

1. 在 `effect` 函数 ① 中，如果参数本身就是一个 `effect` 对象，那么新创建的 `effect` 对象和旧的原始函数指向的是同一个  

### 用到的全局变量  

#### effectStack  
这个变量是一个数组，存储的是执行的 `effect`，在 [createReactiveEffect](#createReactiveEffect) ⑤ 和 ⑧ 可以看到，执行 `fn` 前后分别会将正在执行 `effect` `push` 进去 和 `pop` 出来  

```typescript
const effectStack: ReactiveEffect[] = []
```

#### activeEffect  
这个变量保存的是当前正在执行的 `effect` 对象，在 [createReactiveEffect](#createReactiveEffect) ⑥ 和 🔟 可以看到，执行 `fn` 前后会设置为当前正在执行的 `effect` 和恢复上一个   

```typescript
let activeEffect: ReactiveEffect | undefined
```

## track  
`track` 用来追踪指定对象的指定属性，共有三个参数   
1. 追踪的原始对象
2. 追踪的类型，是一个 `TrackOpTypes` 枚举，这个值只在 `dev` 使用 
3. 追踪的属性名  

```typescript
// 追踪的类型为以下三个之一
const enum TrackOpTypes {
  GET = 'get',        // 获取
  HAS = 'has',        // 设置
  ITERATE = 'iterate' // 遍历
}
```  

```typescript
function track(target: object, type: TrackOpTypes, key: unknown) {
  // ① 检测当前是否需要追踪
  if ( !shouldTrack || activeEffect === undefined ) {
    return
  }

  // ② 获取原始对象对应的 Map
  let depsMap = targetMap.get( target )
  if ( !depsMap ) {
    targetMap.set( target, (depsMap = new Map()))
  }

  // ③ 获取 key 对应的 Set
  let dep = depsMap.get( key )
  if ( !dep ) {
    depsMap.set( key, (dep = new Set()) )
  }

  // 检测 dep 中是否含有当前正在执行的 effect
  if ( !dep.has( activeEffect ) ) {
    // ④
    // 将当前 effect 加到 dep 中，形成 key -> Set<ReactiveEffect> 依赖关系
    dep.add( activeEffect )
    // 将依赖关系的 Set 集合加到当前 effect.deps 里
    // 这一步的主要作用就是 cleanup 的时候需要遍历
    // ⑤
    activeEffect.deps.push( dep )

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

1. 在 ① 处，如果当前暂停了追踪，或者当前没有正在执行的 `effect`，就不会对其追踪，所以，追踪这一步必须要在 `effect` 中才能进行  

```typescript
const observal = reactive({ age: 24 });
observal.age;   // 不会追踪
effect(() => {
  observal.age; // 会追踪
});
```  

2. ② 和 ③ 会从 `targetMap` 取出当前 `key` 的 `Set` 集合（ 如果是第一次会初始化 ），然后将当前的 `effect` 放进集合中（ ④ ）
3. ⑤ 的操作，实际上就是从 `targetMap` 中，取出追踪属性的 `Set` 集合，在 `push` 到 `effect` 中，例如  

```typescript
const observal = reactive({ age: 24, name: 'IconMan', common: 'type' });

const ageEffect = effect(() => {
  observal.age;
  observal.common;
});
```  

`ageEffect.deps` 保存了需要追踪的属性（ `age` 和 `common` ）的 `Set` 集合，这一步的目的在于 [cleanup](#cleanup) 中  

```typescript
ageEffect.deps = [ Set( ageEffect ), Set( ageEffect ) ]
```  

## cleanup  
这个函数用来清除指定 `effect` 的所有依赖，清除的方法就是遍历 `effect.deps`，从中删除指定的 `effect`  
要注意的是，`effect.deps` 数组里的 `Set` 集合，是和 `targetMap` 中指向的同一个，所以 `targetMap` 中也会被删除  

```typescript
function cleanup( effect: ReactiveEffect ) {
  const { deps } = effect
  if ( deps.length ) {
    // 遍历 deps
    for ( let i = 0; i < deps.length; i++ ) {
      deps[i].delete( effect )
    }
    deps.length = 0
  }
}
```  

例如，我们删除上面示例中的 `ageEffect`  

```typescript
cleanup( ageEffect );
```  

结果如下  

```typescript
ageEffect.deps = []
```  

在 [createReactiveEffect](#createReactiveEffect) 创建的 `effect` 对象中，每次执行 `fn` 前都会清除一次所有的依赖，这是为什么？先看这个示例  

```typescript
let dummy;
const observal = reactive({ run: true, age: 24 });
const ageEffect = effect(() => {
  dummy = observal.run ? observal.age : 0;
});
```  

现在 `dummy` 肯定是 `24`，并且追踪了 `run` 和 `age` 两个属性，再执行下面代码  
 
```typescript
// 这句代码执行完后会重新执行一遍 effect 对象
observal.run = false;
```  

现在 `dummy` 就是 `0` 了，并且现在只会追踪 `run` 属性，因为 `age` 并没有被访问到  

所以，每次执行回调前都要清除所有的依赖，要保证追踪的依赖是最新的，不能有之前遗留无效的追踪  

## trigger  

`trigger` 用来触发指定对象上指定属性追踪的依赖，一般用在 `set` 时，共有六个参数  
1. 原始对象
2. 触发的类型，是一个 `TriggerOpTypes` 枚举
3. 触发的属性名
4. `set` 的新值
5. `set` 的旧值
6.   

```typescript
// 触发类型为以下四种之一
const enum TriggerOpTypes {
  SET = 'set',        // 更新
  ADD = 'add',        // 增加
  DELETE = 'delete',  // 删除
  CLEAR = 'clear'     // Map 和 Set 的 clear
}
```   

通过搜索这几个枚举，可以发现他们被用在这些地方  
1. `TriggerOpTypes.SET`: 
    * `reactive`、`shallowReactive` 生成的响应对象在更新时  
    * `Map` 的 `set` 方法（ 更新值而不是新增值 ）
    * `ref` 对象设置值  
2. `TriggerOpTypes.ADD`:  
    * `reactive`、`shallowReactive` 生成的响应对象在新增时  
    * `Map` 的 `set` 方法（ 新增值而不是更新值 ）
    * `Set` 的 `add` 方法   
3. `TriggerOpTypes.DELETE`:  
    * `deelte obj[prop]` 操作  
    * `Map` 和 `Set` 的 `delete` 操作  
4. `TriggerOpTypes.CLEAR`:  
    * `Map` 和 `Set` 的 `clear` 操作  

```typescript
function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get( target )

  // ①
  if ( !depsMap ) {
    // never been tracked
    return
  }

  // 声明计算属性和普通情况的两种 effect 的集合
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()

  const add = ( effectsToAdd: Set<ReactiveEffect> | undefined ) => {
    if ( effectsToAdd ) {
      effectsToAdd.forEach(effect => {
        // TODO 这里暂时不懂
        if ( effect !== activeEffect || !shouldTrack ) {
          // 如果是计算属性，则放入 computedRunners；否则放入 effects
          if ( effect.options.computed ) {
            computedRunners.add( effect )
          } else {
            effects.add( effect )
          }
        } else {
          // the effect mutated its own dependency during its execution.
          // this can be caused by operations like foo.value++
          // do not trigger or we end in an infinite loop
        }
      })
    }
  }

  // 处理不同的操作
  if ( type === TriggerOpTypes.CLEAR ) {
    // ① 处理 Map 和 Set 的 clear 操作，需要触发所有的追踪，所以要把所有的追踪分类，以供后续调用
    depsMap.forEach( add )
  } else if ( key === 'length' && isArray( target ) ) {
    // ② 处理直接修改属性的 length 属性，会执行 length 的追踪，以及修改长度后受影响的元素
    depsMap.forEach(( dep, key ) => {
      if ( key === 'length' || key >= (newValue as number) ) {
        add( dep )
      }
    })
  } else {
    // ③ 新增、更新、删除操作

    // ④ 收集依赖
    if ( key !== void 0 ) {
      add( depsMap.get( key ) )
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    // ⑤ 新增、删除的开关
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target))

    // ⑥
    // 处理新增或者删除
    //  对于非数组的情况，会取 ITERATE_KEY
    //    追踪了迭代属性，例如 JSON.stringify，此时因为添加或者删除了属性，所以需要执行追踪迭代器的 effect
    //      effect.spec.ts -> 36
    //  对于数组的情况，会取 length
    //    默认情况下，使用 数组[下标] 的方式增加元素，是不会触发 length 的 setter 的，所以这里增加了兼容处理，增加元素时都会触发 length 的追踪
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      add( depsMap.get( isArray( target ) ? 'length' : ITERATE_KEY ) )
    }
    
    // ⑦
    if (isAddOrDelete && target instanceof Map) {
      add( depsMap.get( MAP_KEY_ITERATE_KEY ) )
    }
  }

  // 执行 effect
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
    // 如果 effect 存在 scheduler，就调用 scheduler 否则调用本身的 effect
    if ( effect.options.scheduler ) {
      effect.options.scheduler( effect )
    } else {
      effect()
    }
  }

  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  // ⑧
  computedRunners.forEach(run)
  effects.forEach(run)
}
```  

`trigger` 函数主要的逻辑都在中间的 `if` 判断中，这一步的目的就是在于处理不同数据、不同操作情况下，到底哪些依赖是要被触发的，在最后的 ⑧ 处，会通过 `run` 函数触发需要出发的依赖  
`add` 函数会按照是否是计算 `effect` 来收集需要触发的 `effect`  

1. 先看 ② 处，处理的是直接修改数组的 `length` 属性，这种情况，有两种追踪的依赖需要被触发  

    * 追踪了 `length` 属性
    * 一个含有四个元素的数组，修改 `length` 为 `2`，那么后两个元素会被删除，所以索引大于 `2` 的追踪也会触发  

```typescript
let length;
let first;
let third;
const observal = reactive([ 7, 5, 9, 0 ]);

const arrFn = () => {
  length = observal.length; // 追踪 length
  third = observal[2];      // 追踪第三个元素
};
const firstFn = () => {
  first = observal[0];      // 追踪第一个元素
}

const arrEffect = ( arrFn );
const firstEffect = effect( firstFn );

// length -> 4
// first  -> 7
// third  -> 9

observal.length = 2;

// length -> 2
// first  -> 7
// third  -> undefined
```  

修改后，`length` 和 `third` 都发生了变化，而 `first` 不变，所以，`firstFn` 只会执行一次  

2. 对于修改已存在属性来说，会在 ④ 处收集需要触发的依赖，然后再 ⑧ 处执行  

```typescript
const observal = reactive({ age: 24 });
effect(() => {
  dummy = observal.age;
});

// dummy -> 24
observal.age = 25;
// dummy -> 25
```  

3. 对于更新、新增、删除属性操作来说，都会进入 ③ 处理，且在 ④ 会有两种情况  

    * 追踪过该属性，会收集触发的依赖
    * 没有追踪过该属性，不会收集触发的依赖  

```typescript
let dummy;
const observal = reactive({ run: false });
const runEffect = effect(() => {
  dummy = observal.run;
});

// dummy -> false
observal.run = true;
observal.age = 24;
// dummy -> true
```  

触发 `observal.age = 24` 时，在 `trigger` 中不会收集到任何依赖，所以什么也不会做  

4. 看 ⑤ 处的变量，这个变量意味着新增、或者删除的开关，主要用在 ⑥ 和 ⑦ 判断  
    * 如果为 `true`，代表元素的数量发生了变化，所以与遍历或者长度的操作，都需要触发  
    * 对于数组的 `delete` 操作，并不属于删除，因为它只将对应的元素设置为 `undefined` 并不会改变数组的长度，所以过滤了这种情况 `type === TriggerOpTypes.DELETE && !isArray(target)`  
    * 对于 `Map` 实例来说，如果追踪了遍历操作，那么就算是更新值，也是需要触发遍历依赖的  

      ```typescript
      let dummy: number = 0;
      const observal = reactive<Map<string, number>>( new Map() );
      effect(() => {
        dummy = 0;
        for ( const [ , num ] of observal ) {
          dummy += num;
        }
      });

      // dummy -> 0
      observal.set( 'num1', 1 );
      // dummy -> 1
      observal.set( 'num1', 3 );
      // dummy -> 3
      ```  

    * 但是对于普通对象，似乎并没有专门处理更新时，也要收集遍历的依赖  
      这是因为，对于遍历操作来说，始终会和获取每个属性值在同一个 `effect` 中，所以只要修改了其中一个值，都会重新触发  
      如果仅仅是获取属性名，那和值是没有关系的，也就不必再触发依赖