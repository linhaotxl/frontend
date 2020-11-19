**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [介绍](#介绍)
- [queueFlush](#queueflush)
- [job](#job)
    - [queueJob](#queuejob)
- [pre cb](#pre-cb)
    - [queuePreFlushCb](#queuepreflushcb)
    - [flushPreFlushCbs](#flushpreflushcbs)
- [post cb](#post-cb)
    - [queuePostFlushCb](#queuepostflushcb)
    - [flushPostFlushCbs](#flushpostflushcbs)
- [getId](#getid)
- [queueCb](#queuecb)
- [queueFlush](#queueflush-1)
- [flushJobs](#flushjobs)
- [invalidateJob](#invalidatejob)
- [示例](#示例)
    - [允许递归](#允许递归)
    - [父job](#父job)

<!-- /TOC -->

# 介绍

这个文件主要做的就是任务的调度(例如处理组件的 `onMounted` 这样的生命周期)，大致可以分为三种任务  
1. 执行任务前的 “预” 操作，称之为 `pre cb`  
2. 普通任务，称之为 `job`  
3. 执行任务后的操作，称之为 `post cb` 

上面这三种任务都是异步任务，每一种任务都会有一个专门的队列去存储，而源码中会有一个专门刷新队列的方法 [flushJobs](#flushJobs)，这个方法会被放到微任务中执行  

<!-- 在 vue 中，当数据变化时会触发 “异步更新” 去操作 DOM，而这一 “异步更新” 过程就属于一个 `job`，而在更新结束后会触发对应的钩子函数，这一过程就属于 `post cb`   -->

源码中存在两种状态  
1. 等待任务开始：已经将 [flushJobs](#flushJobs) 放进了微任务中等待刷新队列，后续不会再将 [flushJobs](#flushJobs) 放入微任务中，只会将任务放进各自的队列中  
2. 执行任务中：执行 [flushJobs](#flushJobs) 的过程  

由两个全局开关变量控制  

```typescript
let isFlushing     = false  // 执行任务中状态，在开始刷新队列时设置为 true，结束后恢复 false
let isFlushPending = false  // 存在任务需要执行时设置为 true，开始刷新队列时恢复 false
```

<!-- 当第一次更新数据，会将 “异步更新” 放进微任务队列中，这时 `isFlushPending` 就是 `true` 了，而当我们再去更新数据时，此时已经处于 “等待” 状态，所以不会再将同一个 “异步更新” 放入微任务中了   -->
<!-- 
# queueFlush  
这个函数用来将
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

实际上是把 [flushJobs](#flushJobs) 放进微任务队列中，等到同步任务执行结束后，才会执行 [flushJobs](#flushJobs) 遍历所有的队列，执行里面的每一个具体任务   -->

# job  
`job` 使用下面几个全局变量控制  

```typescript
// 保存 job 的队列
const queue: (SchedulerJob | null)[] = []
// 遍历 job 队列时的索引
let flushIndex = 0
```  

## queueJob  
这个方法是 `job` 任务的入队操作  

```typescript
export function queueJob( job: SchedulerJob ) {
    if (
        (!queue.length ||
        !queue.includes(
            job,
            isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex
        )) &&
        job !== currentPreFlushParentJob
    ) {
        queue.push(job)
        queueFlush()
    }
}
```  

**注意：入队时需要满足两个条件才能入队成功**  
1. 检测队列的长度  
    * 如果队列为空，则条件满足  
    * 如果队列非空，需要检测当前入队的 `job` 是否已经存在于队列中  
        * 如果当前处于刷新队列操作中，并且入队的 `job` 允许递归，则会从正在刷新的 `job` 下一个位置开始检测（ 过滤当前刷新的 `job` 从而入队成功 ），参考 [示例：递归](#允许递归)
        * 如果当前不处于刷新队列操作中，则会从头开始检测（ 此时 `flushIndex` 为 0 ）
2. 入队的 `job` 和 `currentPreFlushParentJob` 不相等，参考 [示例：父job](#父job)  

# pre cb  
`pre cb` 使用下面几个全局变量控制  

```typescript
// 等待刷新的 pre 队列
const pendingPreFlushCbs: SchedulerCb[] = []
// 正在刷新的 pre 队列
let activePreFlushCbs: SchedulerCb[] | null = null
// 遍历正在刷新 pre 队列的索引
let preFlushIndex = 0
```  

## queuePreFlushCb  
这个函数是 `pre cb` 的入队操作  

```typescript
export function queuePreFlushCb(cb: SchedulerCb) {
    queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
}
```  

## flushPreFlushCbs  
这个函数用来刷新 `pre` 的队列，执行里面的所有任务  

```typescript
export function flushPreFlushCbs(
    seen?: CountMap,
    parentJob: SchedulerJob | null = null
) {
    if (pendingPreFlushCbs.length) {
        currentPreFlushParentJob = parentJob
        // 去重，将等待队列赋值给正在刷新的队列，然后恢复等待队列
        activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
        pendingPreFlushCbs.length = 0
        
        for (
            preFlushIndex = 0;
            preFlushIndex < activePreFlushCbs.length;
            preFlushIndex++
        ) {
            activePreFlushCbs[preFlushIndex]()
        }
        
        // 遍历完成，恢复正在刷新队列和索引
        activePreFlushCbs = null
        preFlushIndex = 0
        currentPreFlushParentJob = null
        
        // 递归刷新，如果在 pre 任务中再次进行 queuePreFlushCb，那么会再次刷新新增的操作
        flushPreFlushCbs(seen, parentJob)
    }
}
```

# post cb
`post cb` 使用下面几个全局变量控制  

```typescript
// 等待刷新的 post 队列
const pendingPostFlushCbs: SchedulerCb[] = []
// 正在刷新的 post 队列
let activePostFlushCbs: SchedulerCb[] | null = null
// 遍历正在刷新 post 队列的索引
let postFlushIndex = 0
```    

## queuePostFlushCb  
这个函数是 `post cb` 的入队操作  

```typescript
export function queuePostFlushCb(cb: SchedulerCbs) {
    queueCb(cb, activePostFlushCbs, pendingPostFlushCbs, postFlushIndex)
}
```  

## flushPostFlushCbs  
这个函数用来刷新 `post` 的队列，执行里面所有的任务  

```typescript
export function flushPostFlushCbs(seen?: CountMap) {
    if (pendingPostFlushCbs.length) {
        // 去重，并恢复等待队列
        const deduped = [...new Set(pendingPostFlushCbs)]
        pendingPostFlushCbs.length = 0

        // 如果在刷新 post 操作中，又刷新了一次（ 即 flushPostFlushCbs 嵌套调用 ），此时直接将去重后的队列 push 到正在刷新的队列中，避免重复刷新
        if (activePostFlushCbs) {
            activePostFlushCbs.push(...deduped)
            return
        }

        // 更新正在刷新的队列，并排序
        activePostFlushCbs = deduped
        activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

        for (
            postFlushIndex = 0;
            postFlushIndex < activePostFlushCbs.length;
            postFlushIndex++
        ) {
            activePostFlushCbs[postFlushIndex]()
        }

        // 遍历完成，恢复正在刷新队列和索引
        activePostFlushCbs = null
        postFlushIndex = 0
    }
}
```  

# getId  
获取任务的 id，对于 `job` 和 `post` 任务来说，会先将队列中的任务排序再刷新  

```typescript
const getId = (job: SchedulerJob | SchedulerCb) => job.id == null ? Infinity : job.id
```  

# queueCb  
这个函数用来将 `pre cb` 和 `post cb` 进行入队，因为他们入队操作相同，所以提出来作为一个函数  

```typescript
/**
 * @param { SchedulerCbs } cb 入队操作
 * @param { SchedulerCb[] } activeQueue 正在刷新的队列
 * @param { SchedulerCb[] } pendingQueue 等待刷新的队列
 * @param { number } pendingQueue 遍历正在刷新队列的索引
 */
function queueCb(
    cb: SchedulerCbs,
    activeQueue: SchedulerCb[] | null,
    pendingQueue: SchedulerCb[],
    index: number
) {
    // 检测 cb 类型
    if (!isArray(cb)) {
        // 检测入队的 cb 是否存在于正在刷新的队列中
        if (
            !activeQueue ||
            !activeQueue.includes(
                cb,
                (cb as SchedulerJob).allowRecurse ? index + 1 : index
            )
        ) {
            pendingQueue.push(cb)
        }
    } else {
        // if cb is an array, it is a component lifecycle hook which can only be
        // triggered by a job, which is already deduped in the main queue, so
        // we can skip duplicate check here to improve perf
        pendingQueue.push(...cb)
    }
    queueFlush()
}
```  

**注意**  
这里也会对入队的任务做一个去重策略，和 [queueJob](#queueJob) 原理一致，不同的是，检测的是正在刷新的队列 `activeQueue`，如果不存在于其中，则会将任务入队到等待队列中 `pendingQueue` 去  

# queueFlush  
不管是 `job` 的入队，还是 `pre`、`post` 的入队，可以看到，只要发生了入队操作，就一定会调用 `queueFlush` 函数。这个函数用来将刷新队列的操作 [flushJobs](#flushJobs) 放进微任务队列中，并且只会放一次  

```typescript
let currentFlushPromise: Promise<void> | null = null

function queueFlush() {
    if (!isFlushing && !isFlushPending) {
        isFlushPending = true
        currentFlushPromise = resolvedPromise.then(flushJobs)
    }
}
```  

# flushJobs  
这个函数用来刷新队列，并按照下面的顺序去执行所有任务  
1. 通过 [flushPreFlushCbs](#flushPreFlushCbs) 刷新所有的 `pre` 任务，包括其中产生新的 `pre` 任务  
2. 刷新 `job` 队列，包括其中产生新的 `job` 任务  
3. 通过 [flushPostFlushCbs](#flushPostFlushCbs) 刷新所有的 `post` 任务  
4. 检测 `job` 和 `post` 队列是否还存在任务，存在的话通过 `flushJobs` 再次刷新  
    在第三步的 `post` 任务内，可能会进入 [queueJob](#queueJob) 或者 [queuePostFlushCb](#queuePostFlushCb) 操作  

```typescript
function flushJobs(seen?: CountMap) {
    isFlushPending = false
    isFlushing = true

    // 刷新所有的 pre 任务
    flushPreFlushCbs(seen)

    // 对 job 队列中的任务排序
    queue.sort((a, b) => getId(a!) - getId(b!))

    try {
        // 遍历 job
        for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
            const job = queue[flushIndex]
            // 如果 job 存在则调用它，不存在的情况会发生在 invalidateJob 中
            if (job) {
                callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
            }
        }
    } finally {
        // job 遍历结束，恢复索引和队列
        flushIndex = 0
        queue.length = 0

        // 刷新 post 队列
        flushPostFlushCbs(seen)

        isFlushing = false
        currentFlushPromise = null
        
        // 再次刷新 job 和 post 队列
        if (queue.length || pendingPostFlushCbs.length) {
            flushJobs(seen)
        }
    }
}
```  

# invalidateJob  
这个函数可以将 `job` 队列中的任务失效，以至于之后刷新的时候不会执行  

```typescript
export function invalidateJob(job: SchedulerJob) {
    const i = queue.indexOf(job)
    if (i > -1) {
        queue[i] = null
    }
}
```   

# 示例  

## 允许递归  
```typescript
// normal job
let count = 0
const job = () => {
    if (count < 3) {
        count++
        queueJob(job)
    }
}
job.allowRecurse = true
queueJob(job)
await nextTick()
expect(count).toBe(3)
```  

1. 第一次入队肯定能成功，然后到了执行 `job` 内部，此时 `flushIndex` 为 0  
2. 第二次入队，由于 `queue` 中已经存在了 `job`，所以此时会从 `flushIndex + 1`，即 1 开始搜索，结果为 `false`，所以 `job` 再次入队成功，接着会执行刚才入队的 `job`，此时 `flushIndex` 为 1  
2. 第三次入队，由于 `queue` 中已经存在了两个 `job`，所以此时会从 `flushIndex + 1`，即 2 开始搜索，结果为 `false`，所以 `job` 再次入队成功，接着会执行刚才入队的 `job`，此时 `flushIndex` 为 2  

## 父job