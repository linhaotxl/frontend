**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [介绍](#介绍)
- [刷新队列](#刷新队列)
- [job](#job)
- [全局变量](#全局变量)
    - [job](#job-1)
    - [pre](#pre)
    - [post](#post)

<!-- /TOC -->

# 介绍

这个文件主要做的就是任务的调度(例如处理组件的 `onMounted` 这样的生命周期)，大致可以分为三种任务  
1. 执行任务前的 “预” 操作，称之为 `pre cb`  
2. 普通任务，称之为 `job`  
3. 执行任务后的操作，称之为 `post cb` 

上面这三种任务都是异步任务，会放进微任务队列中等待执行  
  
在 vue 中，当数据变化时会触发 “异步更新” 去操作 DOM，而这一 “异步更新” 过程就属于一个 `job`，而在更新结束后会触发对应的钩子函数，这一过程就属于 `post cb`  

在我们执行任务的时候，会存在两种状态  
1. 等待任务开始：这个状态的意思是，已经有异步任务需要执行，存放在微任务队列中等待执行
2. 执行任务中：执行微任务队列中的具体任务  

由两个全局开关变量控制  

```typescript
let isFlushing     = false  // 执行任务中状态，在开始执行微任务队列中的具体任务前设置为 true，任务执行结束恢复 false
let isFlushPending = false  // 等待任务开始状态，需要执行异步任务时设置为 true，执行具体的任务前恢复为 false
```

当第一次更新数据，会将 “异步更新” 放进微任务队列中，这时 `isFlushPending` 就是 `true` 了，而当我们再去更新数据时，此时已经处于 “等待” 状态，所以不会再将同一个 “异步更新” 放入微任务中了  

# 刷新队列  
只要有任务入队，不管是什么任务，都会执行刷新队列操作，这个操作会改变 `isFlushPending` 的状态，同时将遍历队列的操作放在微任务中  

```typescript
function queueFlush() {
    if ( !isFlushing && !isFlushPending ) {
        // 将等待状态设置为 true
        isFlushPending = true
        // flushJobs 是遍历所有队列的操作，将其放进微任务中
        currentFlushPromise = resolvedPromise.then( flushJobs )
    }
}
```  

实际上是把 `flushJobs` 放进微任务队列中，等到同步任务执行结束后，才会执行 `flushJobs` 遍历所有的队列，执行里面的每一个具体任务  

# job  
`job` 使用下面几个全局变量控制  
```typescript
// 保存 job 的队列
const queue: (SchedulerJob | null)[] = []
// 遍历 job 队列时的索引
let flushIndex = 0
```  


# 全局变量  
对于每一种类型的任务，都会有几个相关的全局变量  

## job  
```typescript
// 保存 job 的队列
const queue: (SchedulerJob | null)[] = []
// 遍历 job 队列的索引
let flushIndex = 0
```  

## pre  
```typescript
// 保存 pre 的队列
const pendingPreFlushCbs: SchedulerCb[] = []
let activePreFlushCbs: SchedulerCb[] | null = null
// 遍历 pre 队列的索引
let preFlushIndex = 0
```  

## post  
```typescript
// 保存 post 的队列
const pendingPostFlushCbs: SchedulerCb[] = []
let activePostFlushCbs: SchedulerCb[] | null = null
// 遍历 post 队列的索引
let postFlushIndex = 0
```  