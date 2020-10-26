> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [patchKeyedChildren](#patchkeyedchildren)
    - [第一步: 处理头部相同的 vnode](#第一步-处理头部相同的-vnode)
    - [第二步: 处理尾部相同的 vnode](#第二步-处理尾部相同的-vnode)
    - [处理连续新增节点](#处理连续新增节点)
    - [处理连续删除节点](#处理连续删除节点)
    - [处理剩余情况( 移动，非连续的新增、删除 )](#处理剩余情况-移动非连续的新增删除-)
        - [keyToNewIndexMap](#keytonewindexmap)
        - [newIndexToOldIndexMap](#newindextooldindexmap)
        - [如何知道 vnode 发生了移动](#如何知道-vnode-发生了移动)
        - [遍历老 vnode](#遍历老-vnode)
        - [获取最长稳定子序列](#获取最长稳定子序列)
        - [遍历未被 patch 的 vnode](#遍历未被-patch-的-vnode)

<!-- /TOC -->

# patchKeyedChildren  
这个函数就是用来比较老 `children` 和 新 `children` 的区别，并对有区别的节点做出处理，也就是实现了 `Diff` 算法，总共有五个步骤  

## 第一步: 处理头部相同的 vnode  
从头开始，遍历新老 `children` 两个列表公共部分  
* 如果是相同的 `vnode` 则对其进行 `patch` 操作  
* 如果不是，则记录下 `vnode` 的索引 `i`，并结束遍历  
所以 `i` 就指向从头开始，第一个不相同 `vnode` 的索引  

## 第二步: 处理尾部相同的 vnode
从尾开始，遍历新老 `children` 两个列表  
* 如果是相同的 `vnode` 则对其进行 `patch` 操作  
* 如果不是，则分别记录下老 `children` 的索引 `e1` 和 新 `children` 的索引 `e2`，并结束遍历  
所以 `e1` 指向老 `children` 中，从后往前第一个不相同 `vnode` 的索引，`e2` 指向新 `children` 中，从后往前第一个不相同 `vnode` 的索引  

**经过前两步，已经 patch 了首尾相同的节点，在下面的步骤中，就不会再去处理这些已经 patch 过的节点了，只会处理 [i, e1] 以及 [i,  e2] 范围的节点**  

```typescript
const l2 = c2.length    // 新 children 的长度
let i = 0               // 指向从前往后，第一个不相同 vnode 的指针
let e1 = c1.length - 1  // 指向老 children 中，从后往前，第一个不相同 vnode 的指针
let e2 = l2 - 1         // 指向新 children 中，从后往前，第一个不相同 vnode 的指针

// 第一步，遍历公共部分，同时小于 e1 和 e2
while (i <= e1 && i <= e2) {
    const n1 = c1[i]                // 从前往后获取老 vnode
    const n2 = (c2[i] = optimized   // 从前往后获取新 vnode
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
    if (isSameVNodeType(n1, n2)) {
        // 相同 vnode，进行 patch
        patch(
            n1,
            n2,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    } else {
        // 不同 vnode，直接退出遍历
        break
    }
    i++
}

// 第二步，遍历公共部分，同时小于 e1 和 e2
while (i <= e1 && i <= e2) {
    const n1 = c1[e1]               // 从后往前获取老 vnode
    const n2 = (c2[e2] = optimized  // 从后往前获取新 vnode
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))
    if (isSameVNodeType(n1, n2)) {
        // 相同 vnode，进行 patch
        patch(
            n1,
            n2,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    } else {
        // 不同 vnode，直接退出遍历
        break
    }
    e1--
    e2--
}
```

## 处理连续新增节点  


## 处理连续删除节点  


## 处理剩余情况( 移动，非连续的新增、删除 )  
首先会定义两个指针，分别指向新老 children，且都是从 `i` 开始，也就是从第一个不相同的 `vnode` 开始，不会再处理已经 `patch` 过的 `vnode`，在接下来的遍历也是，只会遍历到 `e1` 或者 `e2`  

```typescript
const s1 = i    // 老 children 的指针
const s2 = i    // 新 children 的指针
```  

### keyToNewIndexMap  
这是一个 `Map` 对象，其中 `key` 是 `vnode.key`，而 `value` 是在新 `children` 的位置索引  
这里会遍历新 `children` 去设置其中的值  

```typescript
const keyToNewIndexMap: Map<string | number, number> = new Map()
// 遍历新 children 中未 patch 的节点，即从 i 到 e2
for ( i = s2; i <= e2; i++ ) {
    const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
    if (nextChild.key != null) {
        if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
                `Duplicate keys found during update:`,
                JSON.stringify(nextChild.key),
                `Make sure keys are unique.`
            )
        }
        keyToNewIndexMap.set(nextChild.key, i)
    }
}
```  

这个变量的作用就是，在之后遍历老 `children` 的时候，可以直接根据 `key` 获取到在新 `children` 里的位置索引，从而去移动，如果获取不到，则说明这是一个新增的 `vnode`  

### newIndexToOldIndexMap  
从名字上可以看出，这应该是一个 新索引 -> 老索引 的对象，而实际上却是一个数组，数组的下标是新索引，而值是老索引 + 1  
需要注意的是，数组里的元素和未被 `patch` 的节点是一一对应的，即数组的长度是未被 `patch` 的节点个数  
第一个元素的下标就是未被 `patch` 的第一个 `vnode` 在新 `children` 里的索引，而值就是它在老 `children` 里的索引 + 1，以此类推  

```typescript
// 没有经过 patch 的节点个数，即除了第一、二步 patch 的节点个数
const toBePatched = e2 - s2 + 1

// 初始化为未被 patch vnode 个数的数组
const newIndexToOldIndexMap = new Array(toBePatched)
// 初始值都为 0，0 表示在老 children 中是不存在的
// 在之后会遍历未被 patch 的 vnode，会判断 newIndexToOldIndexMap 里的值是否是 0
// 如果是 0，则表示这个 vnode 在老 children 不存在，所以需要新增
// 所以 newIndexToOldIndexMap 的值需要加 1，就是为了表示 0 是不存在的 vnode
for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0
```  

而 newIndexToOldIndexMap 被赋值是在之后遍历老 `children` 的时候，为了方便说明，会在这里解释  

此时会遍历老 `children`，会根据 `vnode` 的 `key` 从 `keyToNewIndexMap` 取出在新 `children` 里的位置索引，标记为 `newIndex`，而 `i` 就是老 `vnode` 的位置索引  

```typescript
// newIndex 是当前旧 vnode 在新列表中从头开始计算的索引
// s2 是新列表中，第一个不相同 vnode 的索引，可以理解为是第一个未被 patch 的 vnode 从头开始计算的索引
// newIndex - s2 就是在未被 patch 列表里的索引，而不是从头开始的
newIndexToOldIndexMap[newIndex - s2] = i + 1
```  

### 如何知道 vnode 发生了移动  

先看节点不会发生移动的情况  

A B C  
A B C  

1. 遍历老的 `vnode` A，此时它在 新 `children` 里的索引是 0   
2. 遍历老的 `vnode` B，此时它在 新 `children` 里的索引是 1，  
3. 遍历老的 `vnode` C，此时它在 新 `children` 里的索引是 2    

可以看到，当不发生移动时，新 `children` 的索引是依次递增的  

在看如果发生了移动的情况  

A B C  
C A B  

1. 遍历老的 `vnode` A，此时它在 新 `children` 里的索引是 1  
2. 遍历老的 `vnode` B，此时它在 新 `children` 里的索引是 2  
3. 遍历老的 `vnode` C，此时它在 新 `children` 里的索引是 0  

可以看到，递增的情况被打断了，现在 C 的索引是 0，上一次 B 的索引是 2，反而降低了，由此可以说明，C 被移动了，而且还被移动到了 B 的前面  

在这个过程中，可以看到关键值就是 2，我们称这个值为 ”最大索引值“，如果后续发现，新的索引值 < 最大索引值，那么就说明这个 vnode 发生了移动  

### 遍历老 vnode  

```typescript
// 遍历未被 patch 的老 vnode，即从 s1 开始，一直到 e1 结束
for ( i = s1; i <= e1; i++ ) {
    // 获取老 vnode
    const prevChild = c1[i]
    
    if (patched >= toBePatched) {
        // all new children have been patched so this can only be a removal
        unmount(prevChild, parentComponent, parentSuspense, true)
        continue
    }

    // 获取老节点在新 children 中的索引
    let newIndex
    if (prevChild.key != null) {
        // 通过 key 的形式获取索引
        newIndex = keyToNewIndexMap.get(prevChild.key)
    } else {
        // 不存在 key，遍历新节点，如果和老节点是一个节点，且没有 patch 过，那么这个新节点的索引就是老节点即将渲染的索引
        for (j = s2; j <= e2; j++) {
            if (
                newIndexToOldIndexMap[j - s2] === 0 &&
                isSameVNodeType(prevChild, c2[j] as VNode)
            ) {
                newIndex = j
                break
            }
        }
    }

    if (newIndex === undefined) {
        // 老节点在新列表中没有位置，需要卸载
        unmount(prevChild, parentComponent, parentSuspense, true)
    } else {
        // 更新 newIndexToOldIndexMap 的值
        newIndexToOldIndexMap[newIndex - s2] = i + 1

        // 检测是否发生了移动，如果新索引 < 最大索引值，代表发生移动，标识 moved 为 true，否则更新 最大索引值
        if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
        } else {
            moved = true
        }

        // patch 新老节点
        patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
        // patch 个数 + 1
        patched++
    }
}
```  

### 获取最长稳定子序列  

通过 [getSequence](#getSequence) 函数，计算 [newIndexToOldIndexMap](#newIndexToOldIndexMap) 的最长稳定子序列，计算结果里，每个元素都是新 `children` 中稳定 `vnode` 的位置索引，并且该索引是从未被 `patch` 的列表开始计算的，即 `s2` 开始  
稳定 `vnode` 的意思就是不需要发生移动，和原来的位置一样  

```typescript
// 当有 vnode 移动时，计算稳定序列，否则就是空数组
const increasingNewIndexSequence = moved
    ? getSequence(newIndexToOldIndexMap)
    : EMPTY_ARR

// 指向稳定节点的指针，从后往前
let j = increasingNewIndexSequence.length - 1
```  

### 遍历未被 patch 的 vnode  
这是最后一步，在这一步中会去处理需要移动的 `vnode` 以及新增的 `vnode`  

```typescript
// 从后往前遍历未被 patch 的节点列表
for ( i = toBePatched - 1; i >= 0; i-- ) {
    // 现在 i 是在未被 patch 列表里的索引，而且是从后往前
    // s2 是新列表中，第一个不相同 vnode 的索引，可以理解为未被 patch 列表中，第一个元素从头开始计算的索引
    // s2 + i 就是，未被 patch 的 vnode，从头计算的索引，可以直接从新列表里获取对应的 vnode
    const nextIndex = s2 + i
    // 从新列表获取需要新的 vnode
    const nextChild = c2[nextIndex] as VNode
    // 获取 anchor 节点，检测下一个索引是否存在于列表中，如果存在，则取下一个节点，否则取父 anchor
    const anchor = nextIndex + 1 < l2
        ? (c2[nextIndex + 1] as VNode).el
        : parentAnchor

    // 如果 newIndexToOldIndexMap 中的元素为 0，说明旧列表中不存在，此时需要挂载
    if (newIndexToOldIndexMap[i] === 0) {
        patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
        )
    } else if (moved) {
        // 发生移动，有两种情况需要移动节点
        if (
            j < 0 ||                            // 已经不存在稳定 vnode，只剩下需要移动的 vnode 了
            i !== increasingNewIndexSequence[j] // 当前 vnode 在未被 patch 节点里的索引，和稳定列表里的索引不相同，说明不是稳定 vnode，因为 i 和 j 都是从后往前的指针，所以这里可以直接判断 i 和 increasingNewIndexSequence[j]
        ) {
            move(nextChild, container, anchor, MoveType.REORDER)
        } else {
            // 当前节点是稳定节点，指针向前移动一位
            j--
        }
    }
}
```