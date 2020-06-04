**为了更加清楚理解源码的意义，代码的顺序做了调整**  

# computed  
`computed` 函数用来生成一个计算属性，通过返回对象的 `value` 属性来获取计算后的值，基于 [effect]() 实现，但不同的是  
1. `computed` 中的回调不会立即执行  
2. 只有当 `.value` 的时候才会计算最终的值，并且会将不变的值进行缓存  

## computed 实现  

`computed.value` 来获取最终计算的值，当然这个值也可以被 `set`，所以可以接受一个 `set` 和 `get`，也可以只接受一个 `get`

```typescript
function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 兼容参数只有一个 getter 的情况
  if ( isFunction( getterOrOptions ) ) {
    getter = getterOrOptions
    setter = NOOP // 空函数
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 表示当前追踪的值是否发生了变化，只有在发送变化的时候才需要重新计算
  let dirty = true
  // 真正保存计算后的变量
  let value: T
  // 返回的 computed 对象
  let computed: ComputedRef<T>

  // 创建懒加载的 effect
  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      if ( !dirty ) {
        dirty = true
        // ①
        trigger( computed, TriggerOpTypes.SET, 'value' )
      }
    }
  })

  // 创建 computed 对象，挂载上一步创建的 effect，以及 value 属性
  computed = {
    _isRef: true,
    effect: runner,
    get value() {
      if ( dirty ) {
        // 如果依赖的数据发生了变化，才需要重新计算
        value = runner()
        dirty = false
      }
      // ②
      track( computed, TrackOpTypes.GET, 'value' )
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
  
  return computed
}
```  

1. `computed` 函数内部会创建一个 `effect`，而且是带有 `lazy` 和 `schedule`，所以这个 `effect` 只能在 `.value` 中被手动调用  
2. 追踪的数据是可以被缓存起来，不会重新计算，关键就在于 `dirty` 这个变量  
    当第一次访问 `computed.value` 时，会调用 `effect` 计算一次，并将 `dirty` 置为 `false`，之后，如果依赖数据不发生变化，都不会再重新计算，还是之前的值  
    只有当依赖数据发生变化时，才会进入 `schedule` 将 `dirty` 置为 `true`，以便下次获取时重新计算  

    ```typescript
    const observal = reactive<{ foo: number }>({ foo: 1 })
    const cValue = computed(() => observal.foo );

    cValue.value;   // 1 计算
    cValue.value;   // 1 dirty 为 false 不会计算

    observal.foo = 2;   // 触发 cValue.effect，进入 schedule 修改 dirty

    cValue.value;   // 2 重新计算
    ```  

3. 看 ① 和 ② 处，这两个操作是成对出现的，如果一个 `computed`(以下称为 A) 在其他 `effect` 或者 `computed`(统称为 B) 内部，那么每次获取 A 的值时，都会追踪它外层的 B，这样，当 A 依赖的值发生变化进入 `schedule` 时，就会触发追踪的 B  

    ```typescript
    let dummy: number = 0;
    const observal = reactive({ age: 24 });
    const cValue = computed( () => observal.age );
    effect(() => {
        // 这里首先会追踪 observal.age，追踪的 effect 就是 cValue.effect
        // 再追踪 cValue.effect，追踪 effect 就是当前这个 effect
        dummy = cValue.value;
    });

    // dummy -> 24

    // 先触发追踪 observal.age 的 effect（ 即 cValue.effect ），进入 cValue.effect.schedule
    // 再触发追踪 cValue.effect 的 effect（ 即当前 effect ），重新计算值，修改 dummy
    observal.age = 25;
    // dummy -> 25
    ```  

    我们在 `effect` 内部访问了 `cValue.value`，所以需要对其进行追踪（ 由 ② 实现 ），当依赖的值变化的时候，会进入 `cValue.effect.schedule`，此时需要出发追踪的依赖（ 由 ① 实现 ）  

    ```typescript
    const value = reactive({ foo: 0 })
    const c1 = computed( () => value.foo )
    const c2 = computed( () => c1.value + 1 )

    // 追踪了 value.foo，追踪的 effect -> c1.effect
    // 追踪了 c1.effect，追踪的 effect -> c2.effect
    c2.value; // -> 1
    c1.value; // -> 0

    // 触发追踪 foo 的 effect（ c1.effect ）
    // 执行 c1.effect.schedule，触发追踪 c1.effect 的 effect（ c2.effect ）
    // 执行 c2.effect.schedule，重新计算值
    value.foo++

    c2.value; // -> 2
    c1.value; // -> 1
    ```  

4. 在 `computed` 中，暴露了 `effect`，所以 `computed` 也是可以被停止的  

    ```typescript
    const value = reactive<{ foo?: number }>({})
    const cValue = computed(() => value.foo)
    let dummy
    effect(() => {
      // 追踪 value.foo，追踪的依赖 -> cValue.effect
      // 追踪 cValue.effect，追踪的依赖 -> 当前 effect
      dummy = cValue.value
    })
    dummy; // undefined

    // 触发追踪 foo 的依赖（ cValue.effect ）
    // 触发追踪 cValue.effect 的依赖（ 当前 effect ），重新计算，更新 dummy
    value.foo = 1
    dummy;  // 1

    // 停止了 cValue，现在 cValue.effect 没有任何的追踪
    stop(cValue.effect)

    // 触发追踪 foo 的依赖（ cValue.effect ）
    // 不会再触发追踪 cValue.effect 的依赖
    value.foo = 2

    dummy;  // 1
    ```  

5. 设置 `compued` 的 `set`  

    ```typescript
    const n = ref( 1 )
    const plusOne = computed({
      get: () => n.value + 1,
      set: val => {
        n.value = val - 1
      }
    })

    let dummy
    effect(() => {
      // 追踪 n.value，追踪的依赖是当前 effect
      dummy = n.value
    })

    dummy;  // 1

    // 进一步触发追踪 n.value 的依赖（ 当前 effect ），重新计算，并更新 dummy 的值
    plusOne.value = 0

    dummy;  // -1
    ```