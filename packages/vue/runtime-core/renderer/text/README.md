## Text  

### processText  
这个函数用来处理文本节点的挂载与更新  

```typescript
/**
 * 处理文本节点
 * @param n1 老文本节点
 * @param n2 新文本节点
 * @param container 父节点
 * @param anchor 
 */
const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    if (n1 == null) {
        // 挂载
        // 通过 hostCreateText 创建真实节点，并挂载到 vnode 的 el 上
        // 再通过 hostInsert 插入父节点中
        hostInsert(
            (n2.el = hostCreateText(n2.children as string)),
            container,
            anchor
        )
    } else {
        // 更新
        // 复用旧 vnode 的真实节点
        const el = (n2.el = n1.el!)
        if (n2.children !== n1.children) {
            // 如果文本内容不相同，则重新设置文本
            hostSetText(el, n2.children as string)
        }
    }
}
``` 