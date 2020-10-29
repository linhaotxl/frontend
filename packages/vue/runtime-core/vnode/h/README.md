**为了更加清楚理解源码的意义，代码的顺序做了调整**  

- [h](#h)
    - [示例](#示例)
        - [非两个参数](#非两个参数)
            - [只传 type](#只传-type)
            - [第三个参数为 vNode](#第三个参数为-vnode)
            - [正常参数](#正常参数)
        - [两个参数](#两个参数)
            - [第二个参数为 children 数组](#第二个参数为-children-数组)
            - [第二个参数为 vnode 节点](#第二个参数为-vnode-节点)
        - [第二个参数为 props](#第二个参数为-props)

# h  
这个函数是对 `createVNode` 进行了一层封装，并不是很难，直接来看源码  

```typescript
function h( type: any, propsOrChildren?: any, children?: any ): VNode {
  if ( arguments.length === 2 ) {
    // 处理两个参数情况
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      // 第二个参数为普通对象，可能是 props，也可能是 vnode

      if (isVNode(propsOrChildren)) {
        // 第二个参数为 vnode，将其视作子节点，并且没有 props
        return createVNode(type, null, [propsOrChildren])
      }
      // 第二个参数为 props，没有子节点
      return createVNode(type, propsOrChildren)
    } else {
      // 第二个参数是 children，没有 props
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    // 处理非两个参数情况  
    if (isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children)
  }
}
```  

## 示例  

### 非两个参数  

#### 只传 type  

```typescript
h('div');   // 等价于 createVNode('div')
```  

#### 第三个参数为 vNode  

```typescript
const vnode = h('div'); // 等价于 createVNode('div')
h('div', null, vnode);  // 等价于 createVNode('div', null, [ vnode ])
```  

#### 正常参数  

```typescript
h('div', { class: 'text' }, [
  h('span')
]);
/**
 * 等价于 
 * createVNode('div', { class: 'text' }, [
 *   createVNode('span')
 * ])
 */
```

### 两个参数    

#### 第二个参数为 children 数组  

```typescript
h('div', [
  h('span')
]);
/**
 * 等价于
 * createVNode('div', null, [
 *   createVNode('span')
 * ])
 */
```  

#### 第二个参数为 vnode 节点  

```typescript
const vnode = h('span');
h('div', vnode);    // 等价于 createVNode('div', null, [vnode])
```  

### 第二个参数为 props  

```typescript
h('div', { class: 'text' });    // 等价于 createVNode('div', { class: 'text' })
```
