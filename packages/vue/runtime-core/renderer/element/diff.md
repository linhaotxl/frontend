<!-- TOC -->

- [示例一](#示例一)
- [示例二](#示例二)
- [实例三](#实例三)
- [示例四](#示例四)
- [示例五](#示例五)
- [示例六](#示例六)

<!-- /TOC -->

# 示例一  

1 2 3 4
2 3 1 4

keyToNewIndexMap: {
    2: 0,
    3: 1,
    1: 2
}

newIndexToOldIndexMap: [ 2, 3, 1 ]

在新列表中，下标为这些的节点是不需要移动的
increasingNewIndexSequence: [ 0, 1 ]

1 2 3 4
1 4 2 3  

keyToNewIndexMap: {
    4: 1,
    2: 2,
    3: 3
}

newIndexToOldIndexMap: [ 4, 2, 3 ]

在新列表中，下标为这些的节点是不需要移动的
increasingNewIndexSequence: [ 1, 2 ]

开始遍历老节点
2. 当前节点是 2，它在旧列表里的索引是 1，新列表里的索引是 2，最大索引是 2
3. 当前节点是 3，它在旧列表里的索引是 2，新列表里的索引是 3，最大索引是 3
4. 当前节点是 4，它在旧列表里的索引是 3，新列表里的索引是 1，说明在新列表中，节点4 需要移动

# 示例二  

1 2 3 4
4 2 3 1  

keyToNewIndexMap: {
    4: 0,
    2: 1,
    3: 2,
    1: 3,
}

newIndexToOldIndexMap: [ 0, 0, 0, 1 ]

开始遍历老节点
1. 当前节点是 1，它在旧列表里的索引是 0，新列表里的索引是 3，最大索引是 3
2. 当前节点是 2，它在旧列表里的索引是 1，新列表里的索引是 1，说明在新列表中，节点2 需要移动
3. 当前节点是 3，它在旧列表里的索引是 2，新列表里的索引是 2，说明在新列表中，节点3 需要移动
4. 当前节点是 4，它在旧列表里的索引是 3，新列表里的索引是 0，说明在新列表中，节点3 需要移动

# 实例三  

1, 2, 3, 4, 5
4, 1, 2, 3, 6  

keyToNewIndexMap: {
    4: 0,
    1: 1,
    2: 2,
    3: 3,
    6: 4,
}

newIndexToOldIndexMap: [ 0, 1, 2, 0, 0 ]  

# 示例四  

1, 4, 5
4, 6  

keyToNewIndexMap: {
    4: 0,
    6: 1
}

newIndexToOldIndexMap: [ 2, 0 ]  

# 示例五  

2, 4, 5  
4, 5, 3  

keyToNewIndexMap: {
    4: 0,
    5: 1,
    3: 2
}

newIndexToOldIndexMap: [ 2, 3, 0 ]  

# 示例六  

1, 2, 3, 4, 5, 6, 7, 8  
8, 7, 6, 5, 4, 3, 2, 1  

keyToNewIndexMap: {
    8: 0,
    7: 1,
    6: 2,
    5: 3,
    4: 4,
    3: 5,
    2: 6,
    1: 7,
}  

newIndexToOldIndexMap: [ 8, 7, 6, 5, 4, 3, 2, 1 ]  

1. 遍历老 `vnode` 1，它在新 `children` 里的索引是 7，最大索引为 7  
2. 遍历老 `vnode` 2，它在新 `children` 里的索引是 6，小于最大索引 7，发生移动    
3. 遍历老 `vnode` 3，它在新 `children` 里的索引是 5，小于最大索引 7，发生移动    
4. 遍历老 `vnode` 4，它在新 `children` 里的索引是 4，小于最大索引 7，发生移动    
5. 遍历老 `vnode` 5，它在新 `children` 里的索引是 3，小于最大索引 7，发生移动    
6. 遍历老 `vnode` 6，它在新 `children` 里的索引是 2，小于最大索引 7，发生移动    
7. 遍历老 `vnode` 7，它在新 `children` 里的索引是 1，小于最大索引 7，发生移动    
8. 遍历老 `vnode` 8，它在新 `children` 里的索引是 0，小于最大索引 7，发生移动     

increasingNewIndexSequence: [ 7 ]